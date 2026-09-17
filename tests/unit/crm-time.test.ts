import { describe, expect, it } from "vitest";
import { addDays, isLocalDate, isLocalDateTime, localDayRange, localToUtc, startOfWeek, utcToLocalInput } from "@/server/crm/time";

describe("zona horaria de la agenda (America/Argentina/Salta)", () => {
  it("convierte hora local de Salta a UTC (UTC-3) y vuelve", () => {
    const d = localToUtc("2026-09-16T10:30");
    expect(d.toISOString()).toBe("2026-09-16T13:30:00.000Z");
    expect(utcToLocalInput(d)).toBe("2026-09-16T10:30");
  });
  it("cruza el día correctamente", () => {
    expect(localToUtc("2026-12-31T22:00").toISOString()).toBe("2027-01-01T01:00:00.000Z");
    expect(utcToLocalInput(new Date("2027-01-01T02:15:00Z"))).toBe("2026-12-31T23:15");
  });
  it("rango de un día local", () => {
    const r = localDayRange("2026-09-16");
    expect(r.from.toISOString()).toBe("2026-09-16T03:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-09-17T03:00:00.000Z");
  });
  it("valida formatos y fechas imposibles", () => {
    expect(isLocalDateTime("2026-02-30T10:00")).toBe(false);
    expect(isLocalDateTime("2026-02-28T24:00")).toBe(false);
    expect(isLocalDateTime("2026-02-28T09:05")).toBe(true);
    expect(isLocalDate("2026-13-01")).toBe(false);
    expect(() => localToUtc("mañana")).toThrow();
  });
  it("semanas y sumas de días", () => {
    expect(startOfWeek("2026-09-16")).toBe("2026-09-14"); // miércoles → lunes
    expect(startOfWeek("2026-09-20")).toBe("2026-09-14"); // domingo → lunes anterior
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });
});
