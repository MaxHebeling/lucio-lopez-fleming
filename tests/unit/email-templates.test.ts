import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EMAIL_TEMPLATES, TemplateError, appLink, escapeHtml, redactSensitive, renderEmail } from "@/server/messaging/templates";

const XSS = `<script>alert("x")</script><img src=x onerror=alert(1)>`;

describe("plantillas de email", () => {
  const prev = process.env.APP_URL;
  beforeEach(() => {
    process.env.APP_URL = "https://www.luciolopezfleming.com.ar";
  });
  afterEach(() => {
    process.env.APP_URL = prev;
  });

  it("escapa TODO contenido dinámico (XSS) en el HTML", () => {
    const r = renderEmail("lead_internal_notice", {
      leadPath: "/crm/leads/00000000-0000-4000-8000-000000000001",
      contactName: XSS,
      sourceName: `Web "><b>`,
      propertyLabel: "1203 · Casa <b>linda</b>",
      message: XSS,
    });
    expect(r.html).not.toContain("<script>");
    expect(r.html).not.toContain("<img src=x");
    expect(r.html).not.toContain("<b>linda</b>");
    expect(r.html).toContain("&lt;script&gt;");
    expect(r.subject).toContain(`Web "><b>`); // el asunto es texto plano, no HTML
    expect(r.text).toContain(XSS); // la versión texto no se interpreta como HTML
    expect(escapeHtml(`'"&<>`)).toBe("&#39;&quot;&amp;&lt;&gt;");
  });

  it("todas las plantillas renderizan HTML y texto plano con la marca", () => {
    const samples: Record<string, unknown> = {
      password_reset: { fullName: "Ana", resetUrl: "/crm/restablecer?token=abc" },
      owner_password_reset: { fullName: "Ana", resetUrl: "/propietarios/restablecer?token=abc" },
      staff_invite: { fullName: "Ana", inviteUrl: "/crm/invitacion?token=abc", invitedBy: "Ignacio" },
      owner_invite: { fullName: "Ana", inviteUrl: "/propietarios/invitacion?token=abc" },
      owner_report_ready: { fullName: "Ana", periodLabel: "agosto 2026", reportUrl: "/propietarios/informes/1" },
      rent_due_reminder: { recipientName: "Ana", propertyLabel: "Dpto. Balcarce 100", dueDate: "2026-10-10", amount: "700000", currency: "ARS" },
      lead_internal_notice: { leadPath: "/crm/leads/00000000-0000-4000-8000-000000000001" },
    };
    expect(Object.keys(samples).sort()).toEqual(Object.keys(EMAIL_TEMPLATES).sort());
    for (const [key, payload] of Object.entries(samples)) {
      const r = renderEmail(key, payload);
      expect(r.subject.length).toBeGreaterThan(5);
      expect(r.html).toContain("#AE2C25");
      expect(r.html).toContain("Lucio López Fleming");
      expect(r.text).not.toMatch(/<[a-z]/i);
    }
    expect(renderEmail("rent_due_reminder", samples.rent_due_reminder).text).toContain("$ 700.000");
  });

  it("links solo hacia APP_URL", () => {
    expect(appLink("/crm/x?token=1")).toBe("https://www.luciolopezfleming.com.ar/crm/x?token=1");
    expect(appLink("https://www.luciolopezfleming.com.ar/a")).toBe("https://www.luciolopezfleming.com.ar/a");
    expect(() => appLink("https://evil.example.com/crm")).toThrow(TemplateError);
    expect(() => appLink("//evil.example.com/crm")).toThrow(TemplateError);
    expect(() => appLink("javascript:alert(1)")).toThrow(TemplateError);
    expect(() => renderEmail("password_reset", { fullName: "Ana", resetUrl: "https://phishing.example.com/reset" })).toThrow(/fuera de APP_URL/);
  });

  it("plantilla desconocida o payload inválido → TemplateError (permanente)", () => {
    expect(() => renderEmail("no_existe", {})).toThrow(TemplateError);
    expect(() => renderEmail("rent_due_reminder", { recipientName: "Ana" })).toThrow(/Payload inválido/);
  });

  it("redacta datos de un solo uso después del envío", () => {
    const out = redactSensitive("password_reset", { fullName: "Ana", resetUrl: "/crm/restablecer?token=secreto" });
    expect(JSON.stringify(out)).not.toContain("secreto");
    expect(out.fullName).toBe("Ana");
    expect(redactSensitive("owner_report_ready", { reportUrl: "/x" })).toEqual({ reportUrl: "/x" });
  });
});
