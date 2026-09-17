/**
 * Cálculos de alquileres. ATENCIÓN: todos los valores de índices de este archivo son FIXTURES DE TEST
 * elegidos a mano para verificar la aritmética. NO son valores oficiales del BCRA ni del INDEC.
 */
import { describe, expect, it } from "vitest";
import {
  allocateCents,
  applyRatioToCents,
  centsToString,
  div,
  normalizeMoneyInput,
  parseRatio,
  percentOfCents,
  ratioToFixed,
  toCents,
} from "@/server/rentals/decimal";
import { addDays, addMonths, dueDateFor, isIsoDate, monthlyPeriods, todayInSalta } from "@/server/rentals/dates";
import {
  calculateAdjustment,
  monthlyCoefficientFromPct,
  monthsForPeriod,
  pctFromCoefficient,
  pickOnOrBefore,
  previousPeriodStart,
} from "@/server/rentals/adjustment-calc";
import { amountForPeriod, obligationStatus } from "@/server/rentals/obligations";
import { fetchBcraSeries, BCRA_VARIABLES } from "@/server/integrations/bcra";

describe("aritmética exacta de dinero", () => {
  it("centavos sin float: 0.1 + 0.2 = 0.30", () => {
    expect(centsToString(toCents("0.1") + toCents("0.2"))).toBe("0.30");
    expect(centsToString(toCents("150000") + toCents("0.01"))).toBe("150000.01");
    expect(centsToString(-toCents("12.5"))).toBe("-12.50");
  });

  it("rechaza montos con más de 2 decimales y normaliza la entrada del formulario", () => {
    expect(() => toCents("1.005")).toThrow(/2 decimales/);
    expect(normalizeMoneyInput("150000,5")).toBe("150000.50");
    expect(normalizeMoneyInput(" 99.99 ")).toBe("99.99");
    expect(normalizeMoneyInput("1.000.000")).toBeNull();
    expect(normalizeMoneyInput("-5")).toBeNull();
    expect(normalizeMoneyInput("1e5")).toBeNull();
  });

  it("redondeo half-up a centavos", () => {
    expect(applyRatioToCents(toCents("0.01"), parseRatio("0.5"))).toBe(1n); // 0.005 → 0.01
    expect(applyRatioToCents(toCents("0.01"), parseRatio("0.49"))).toBe(0n); // 0.0049 → 0.00
    expect(percentOfCents(toCents("123456.78"), "8.5")).toBe(1049383n); // 10493.8263 → 10493.83
    expect(percentOfCents(toCents("100.10"), "5")).toBe(501n); // 5.005 → 5.01
  });

  it("factor mostrado con 8 decimales half-up", () => {
    expect(ratioToFixed(div(parseRatio("2"), parseRatio("3")), 8)).toBe("0.66666667");
    expect(ratioToFixed(parseRatio("1.123456785"), 8)).toBe("1.12345679");
  });

  it("reparto por mayor resto no pierde ni inventa centavos", () => {
    expect(allocateCents(10001n, [parseRatio("50"), parseRatio("50")])).toEqual([5001n, 5000n]);
    expect(allocateCents(100n, [parseRatio("33.33"), parseRatio("33.33"), parseRatio("33.34")])).toEqual([33n, 33n, 34n]);
    const parts = allocateCents(9999999n, [parseRatio("12.5"), parseRatio("37.5"), parseRatio("50")]);
    expect(parts.reduce((a, b) => a + b, 0n)).toBe(9999999n);
  });
});

describe("fechas de calendario", () => {
  it("suma meses y recorta a fin de mes", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-11-01", 3)).toBe("2027-02-01");
    expect(addMonths("2026-03-01", -3)).toBe("2025-12-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("períodos mensuales [inicio, fin) y vencimientos", () => {
    expect(monthlyPeriods("2026-01-01", "2026-04-01")).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
    expect(monthlyPeriods("2026-01-01", "2026-03-31")).toHaveLength(3);
    expect(dueDateFor("2026-02-01", 10)).toBe("2026-02-10");
    expect(isIsoDate("2026-02-30")).toBe(false);
  });

  it("'hoy' se calcula en hora de Salta (UTC-3)", () => {
    expect(todayInSalta(new Date("2026-09-17T02:30:00Z"))).toBe("2026-09-16");
    expect(todayInSalta(new Date("2026-09-17T03:30:00Z"))).toBe("2026-09-17");
  });
});

describe("cuotas", () => {
  it("estado según pagado y vencimiento", () => {
    expect(obligationStatus("100.00", "0", "2026-09-10", "2026-09-05")).toBe("pending");
    expect(obligationStatus("100.00", "40.00", "2026-09-10", "2026-09-05")).toBe("partially_paid");
    expect(obligationStatus("100.00", "40.00", "2026-09-10", "2026-09-11")).toBe("overdue");
    expect(obligationStatus("100.00", "100.00", "2026-09-10", "2026-09-11")).toBe("paid");
  });

  it("monto vigente por período según ajustes aplicados", () => {
    const applied = [
      { effective_date: "2026-04-01", new_amount: "120000.00" },
      { effective_date: "2026-07-01", new_amount: "130000.50" },
    ];
    expect(amountForPeriod("100000", applied, "2026-03-01")).toBe("100000.00");
    expect(amountForPeriod("100000", applied, "2026-04-01")).toBe("120000.00");
    expect(amountForPeriod("100000", applied, "2026-12-01")).toBe("130000.50");
  });
});

describe("ajustes por índice (valores = FIXTURES DE TEST, no oficiales)", () => {
  const FIXTURE_ICL = [
    { date: "2026-01-01", value: "12.34" },
    { date: "2026-03-28", value: "15.10" },
    { date: "2026-04-01", value: "15.67" },
  ];

  it("ICL: factor = valor(fecha efectiva) / valor(inicio del período), monto half-up", () => {
    const r = calculateAdjustment({ indexKey: "ICL", previousAmount: "250000.00", periodStart: "2026-01-01", effectiveDate: "2026-04-01", periodMonths: 3, values: FIXTURE_ICL });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 250000 × 15.67 / 12.34 = 317463.5332… → 317463.53
    expect(r.newAmount).toBe("317463.53");
    expect(r.factor).toBe("1.26985413");
    expect(r.start).toEqual({ requestedDate: "2026-01-01", usedDate: "2026-01-01", value: "12.34" });
    expect(r.end).toEqual({ requestedDate: "2026-04-01", usedDate: "2026-04-01", value: "15.67" });
  });

  it("ICL: sin el día exacto usa el último valor anterior (hasta 7 días) y lo registra", () => {
    const values = [
      { date: "2025-12-29", value: "12.34" },
      { date: "2026-03-28", value: "15.67" },
    ];
    const r = calculateAdjustment({ indexKey: "ICL", previousAmount: "250000", periodStart: "2026-01-01", effectiveDate: "2026-04-01", periodMonths: 3, values });
    expect(r.ok && r.start?.usedDate).toBe("2025-12-29");
    expect(r.ok && r.end?.usedDate).toBe("2026-03-28");
    expect(r.ok && r.newAmount).toBe("317463.53");
  });

  it("si falta un valor NO calcula y devuelve qué falta", () => {
    const r = calculateAdjustment({ indexKey: "CER", previousAmount: "250000", periodStart: "2026-01-01", effectiveDate: "2026-04-01", periodMonths: 3, values: [{ date: "2026-01-01", value: "700.5" }] });
    expect(r).toEqual({ ok: false, indexKey: "CER", missing: [expect.stringContaining("2026-04-01")] });
    // Un valor de hace más de 7 días no sirve
    expect(pickOnOrBefore([{ date: "2026-03-20", value: "1" }], "2026-04-01")).toBeNull();
    expect(pickOnOrBefore([{ date: "2026-03-25", value: "1" }, { date: "2026-04-02", value: "2" }], "2026-04-01")?.date).toBe("2026-03-25");
  });

  it("IPC: producto de coeficientes mensuales del período", () => {
    const values = [
      { date: "2026-01-01", value: monthlyCoefficientFromPct("2.5") },
      { date: "2026-02-01", value: monthlyCoefficientFromPct("3") },
      { date: "2026-03-01", value: monthlyCoefficientFromPct("2.0") },
    ];
    const r = calculateAdjustment({ indexKey: "IPC", previousAmount: "180000", periodStart: "2026-01-01", effectiveDate: "2026-04-01", periodMonths: 3, values });
    // 1.025 × 1.03 × 1.02 = 1.076865 → 180000 × 1.076865 = 193835.70
    expect(r.ok && r.newAmount).toBe("193835.70");
    expect(r.ok && r.factor).toBe("1.07686500");
    expect(r.ok && r.months?.map((m) => m.month)).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
    const missing = calculateAdjustment({ indexKey: "IPC", previousAmount: "180000", periodStart: "2026-01-01", effectiveDate: "2026-04-01", periodMonths: 3, values: values.slice(0, 2) });
    expect(missing).toEqual({ ok: false, indexKey: "IPC", missing: ["IPC de 2026-03"] });
  });

  it("coeficiente mensual ↔ variación %", () => {
    expect(monthlyCoefficientFromPct("2.7")).toBe("1.02700000");
    expect(monthlyCoefficientFromPct("-0.3")).toBe("0.99700000");
    expect(pctFromCoefficient("1.02700000")).toBe("2.7000");
    expect(() => monthlyCoefficientFromPct("-100")).toThrow();
  });

  it("período anterior y meses del período", () => {
    expect(previousPeriodStart("2026-07-01", 3, "2026-01-01")).toBe("2026-04-01");
    expect(previousPeriodStart("2026-04-01", 6, "2026-01-01")).toBe("2026-01-01");
    expect(monthsForPeriod("2026-11-01", 3)).toEqual(["2026-11-01", "2026-12-01", "2027-01-01"]);
  });
});

describe("adaptador BCRA (respuesta simulada con FIXTURES, sin red)", () => {
  const body = (detalle: Array<{ fecha: string; valor: number }>, count = detalle.length, id = 40) =>
    JSON.stringify({ status: 200, metadata: { resultset: { count, offset: 0, limit: 3000 } }, results: [{ idVariable: id, detalle }] });

  it("usa la variable 40 para ICL y 30 para CER, y parsea el formato v4.0", async () => {
    expect(BCRA_VARIABLES).toEqual({ CER: 30, ICL: 40 });
    const urls: string[] = [];
    const fetchImpl = async (url: string) => {
      urls.push(url);
      return new Response(body([{ fecha: "2026-01-02", valor: 12.35 }, { fecha: "2026-01-01", valor: 12.34 }]), { status: 200 });
    };
    const points = await fetchBcraSeries("ICL", "2026-01-01", "2026-01-02", { fetchImpl });
    expect(urls[0]).toBe("https://api.bcra.gob.ar/estadisticas/v4.0/monetarias/40?desde=2026-01-01&hasta=2026-01-02&limit=3000&offset=0");
    expect(points).toEqual([
      { date: "2026-01-01", value: "12.34" },
      { date: "2026-01-02", value: "12.35" },
    ]);
  });

  it("reintenta 5xx, no reintenta 400 y rechaza formatos inesperados", async () => {
    let calls = 0;
    const flaky = async () => (++calls < 2 ? new Response("down", { status: 503 }) : new Response(body([{ fecha: "2026-01-01", valor: 1 }], 1, 30), { status: 200 }));
    await expect(fetchBcraSeries("CER", "2026-01-01", "2026-01-01", { fetchImpl: flaky })).resolves.toHaveLength(1);
    expect(calls).toBe(2);

    let badCalls = 0;
    const bad = async () => {
      badCalls++;
      return new Response(JSON.stringify({ status: 400, errorMessages: ["fecha"] }), { status: 400 });
    };
    await expect(fetchBcraSeries("CER", "2026-01-01", "2026-01-01", { fetchImpl: bad })).rejects.toThrow(/BCRA 400/);
    expect(badCalls).toBe(1);

    const weird = async () => new Response(JSON.stringify({ foo: 1 }), { status: 200 });
    await expect(fetchBcraSeries("ICL", "2026-01-01", "2026-01-01", { fetchImpl: weird })).rejects.toThrow(/Formato inesperado/);
  });
});
