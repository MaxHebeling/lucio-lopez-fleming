import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import type { Actor, StaffActor } from "@/server/auth/actor";

const current: { actor: Actor } = { actor: { kind: "anonymous", organizationId: "org" } };
vi.mock("@/server/next/context", () => ({ getActor: async () => current.actor }));

import { runAction } from "@/server/next/action";
import { apiRoute } from "@/server/next/api";
import { SESSION_COOKIE } from "@/server/auth/session";

function staff(mustChangePassword: boolean): StaffActor {
  return { kind: "staff", organizationId: "org", userId: "u1", email: "a@test.local", fullName: "A", roles: ["super_admin"], permissions: new Set(), branchIds: [], mustChangePassword };
}

const run = (name: string) => runAction(name, z.object({}), {}, async () => "hecho");
const post = (cookie: boolean, method = "POST") =>
  new NextRequest("http://localhost/api/crm/x", { method, headers: cookie ? { cookie: `${SESSION_COOKIE}=${"t".repeat(40)}` } : {} });
const route = apiRoute("properties.media.upload", async () => NextResponse.json({ ok: true }));

describe("cambio de contraseña obligatorio", () => {
  beforeEach(() => {
    current.actor = staff(true);
  });

  it("runAction rechaza cualquier acción salvo cambiar la contraseña", async () => {
    expect(await run("properties.update")).toMatchObject({ ok: false, error: expect.stringMatching(/cambiar tu contraseña/) });
    expect(await run("account.change_password")).toEqual({ ok: true, data: "hecho" });
    current.actor = staff(false);
    expect(await run("properties.update")).toEqual({ ok: true, data: "hecho" });
  });

  it("apiRoute rechaza mutaciones con sesión de un staff con cambio pendiente (403); lecturas y requests sin cookie siguen", async () => {
    expect((await route(post(true), {})).status).toBe(403);
    expect((await route(post(true, "GET"), {})).status).toBe(200);
    expect((await route(post(false), {})).status).toBe(200);
    current.actor = staff(false);
    expect((await route(post(true), {})).status).toBe(200);
  });
});
