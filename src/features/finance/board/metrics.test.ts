import { describe, expect, it } from "vitest";
import { breakdown, cashView, channelRows, classRows, depreciationCents, fixedMonthlyCents, moneyChange, period, rateChange, storeRows, totals, type CashReport, type FleetVehicle, type PnlRow } from "./metrics";

const line = (group: string | null, account: string, kind: string, net: number): PnlRow => ({
  group_key: group,
  account,
  kind,
  name_zh: account,
  name_en: account,
  debit_cents: net < 0 ? -net : 0,
  credit_cents: net > 0 ? net : 0,
});

const car = (overrides: Partial<FleetVehicle>): FleetVehicle => ({
  id: "v",
  fleetNumber: "MY-1",
  plate: null,
  classId: "c1",
  classSlug: "model-y-basic",
  className: "Model Y",
  classNameZh: "Model Y 标准",
  condition: "IN_SERVICE",
  createdOn: "2026-11-01",
  inServiceOn: null,
  serviceFrom: "2026-11-01",
  retiredOn: null,
  ownerExitOn: null,
  purchasePriceCents: null,
  depreciationMonths: null,
  residualCents: null,
  monthlyPaymentCents: null,
  purchaseTax: null,
  taxEvidencePath: null,
  insuranceMonthlyCents: null,
  registrationYearlyCents: null,
  costsUpdatedAt: null,
  ownerCar: false,
  serviceDays: 0,
  rentedDays: 0,
  revenueDays: 0,
  downDays: 0,
  depreciationDays: 0,
  ...overrides,
});

const firstOrder = [
  line("v1", "4010", "REVENUE", 325080),
  line("v1", "4020", "REVENUE", 84000),
  line("v1", "4930", "CONTRA_REVENUE", -211180),
  line("v1", "5010", "COST", -110084),
  line("v1", "5030", "COST", -5769),
];

describe("totals", () => {
  it("splits revenue, discounts, owner share and costs", () => {
    expect(totals([...firstOrder, line("v1", "4080", "REVENUE", 5000), line("v1", "6050", "EXPENSE", -7000), line("v1", "6030", "EXPENSE", -2000)])).toEqual({
      gross: 409080,
      discounts: 211180,
      revenue: 197900,
      rent: 325080,
      recoveries: 5000,
      owner: 110084,
      orderCosts: 5769,
      expenses: 9000,
      fixedExpenses: 2000,
      net: 197900 + 5000 - 110084 - 5769 - 9000,
    });
  });
});

describe("period", () => {
  const owner = car({ id: "v1", fleetNumber: "MY-111926", ownerCar: true, serviceDays: 59, rentedDays: 28, revenueDays: 28, inServiceOn: "2026-11-19" });
  const own = car({ id: "v2", fleetNumber: "MY-111626", classId: "c2", className: "Model Y Premium", classNameZh: null, serviceDays: 59, depreciationDays: 59, rentedDays: 0, downDays: 4, inServiceOn: "2026-11-12", purchasePriceCents: 6000000, depreciationMonths: 60, insuranceMonthlyCents: 20000, registrationYearlyCents: 60000 });
  const company = [line(null, "6110", "EXPENSE", -72904), line(null, "5030", "COST", -66), line("zz-car", "4070", "REVENUE", 3000)];
  const result = period([...firstOrder, ...company], [owner, own]);

  it("matches the first order's contribution", () => {
    const row = result.rows.find((item) => item.vehicle.id === "v1")!;
    expect(row.revenue).toBe(197900);
    expect(row.ownerShare).toBe(110084);
    expect(row.costs).toBe(5769);
    expect(row.contribution).toBe(82047);
    expect(row.contribution / row.revenue).toBeCloseTo(0.4146, 4);
    expect(result.discountRate).toBeCloseTo(211180 / (409080 + 3000), 6);
    expect(period(firstOrder, [owner]).discountRate).toBeCloseTo(0.5162, 4);
  });

  it("takes depreciation off the own car and keeps company costs apart", () => {
    const row = result.rows.find((item) => item.vehicle.id === "v2")!;
    expect(row.depreciation).toBe(Math.round((6000000 / 60 / (365.25 / 12)) * 59));
    expect(result.contribution).toBe(82047 - row.depreciation);
    expect(result.unassignedRevenue).toBe(3000);
    expect(result.companyCosts).toBe(72970);
    expect(result.operatingProfit).toBe(result.contribution + 3000 - 72970);
    expect(result.contributionRatio).toBeCloseTo((82047 - row.depreciation) / 197900, 6);
  });

  it("works out occupancy, daily rent and break-even days", () => {
    expect(result.availableDays).toBe(59 + 55);
    expect(result.occupancy).toBeCloseTo(28 / 114, 6);
    expect(result.adr).toBeCloseTo((325080 - 211180) / 28, 6);
    expect(result.revenuePerCarMonth).toBeCloseTo(197900 / (118 / (365.25 / 12)), 6);
    expect(result.fixedPerCarMonth).toBeCloseTo(100000 + 20000 + 5000, 6);
    expect(result.breakEvenDays).toBeCloseTo(125000 / ((197900 - 110084 - 5769) / 28), 6);
    expect(result.unregistered).toBe(0);
  });

  it("counts days of orders not yet in the books for occupancy but not for daily rent", () => {
    const pending = period(firstOrder, [car({ id: "v1", serviceDays: 30, rentedDays: 20, revenueDays: 10 })]);
    expect(pending.occupancy).toBeCloseTo(20 / 30, 6);
    expect(pending.adr).toBeCloseTo((325080 - 211180) / 10, 6);
    const none = period([], [car({ id: "v1", serviceDays: 30, rentedDays: 20, revenueDays: 0 })]);
    expect(none.adr).toBeNull();
  });

  it("leaves rates empty without days or revenue", () => {
    const empty = period([], [car({ id: "v3" })]);
    expect(empty.occupancy).toBeNull();
    expect(empty.adr).toBeNull();
    expect(empty.revenuePerCarMonth).toBeNull();
    expect(empty.fixedPerCarMonth).toBeNull();
    expect(empty.breakEvenDays).toBeNull();
    expect(empty.discountRate).toBeNull();
    expect(empty.contributionRatio).toBeNull();
    expect(empty.unregistered).toBe(1);
  });
});

describe("depreciation", () => {
  const vehicle = { purchasePriceCents: 3043750, depreciationMonths: 10, residualCents: null, depreciationDays: 19 };

  it("charges each depreciation day at the price over the months", () => {
    expect(depreciationCents(vehicle)).toBe(19 * 10000);
    expect(depreciationCents({ ...vehicle, depreciationDays: 0 })).toBe(0);
    expect(depreciationCents({ ...vehicle, purchasePriceCents: null })).toBe(0);
  });

  it("leaves the residual value undepreciated", () => {
    expect(depreciationCents({ ...vehicle, purchasePriceCents: 4043750, residualCents: 1000000 })).toBe(19 * 10000);
  });

  it("adds up the monthly fixed cost", () => {
    const base = { purchasePriceCents: 6000000, depreciationMonths: 60, residualCents: null, monthlyPaymentCents: null, insuranceMonthlyCents: 20000, registrationYearlyCents: 60000 };
    expect(fixedMonthlyCents(base)).toBe(125000);
    expect(fixedMonthlyCents({ ...base, residualCents: 1200000 })).toBe(105000);
    expect(fixedMonthlyCents({ ...base, purchasePriceCents: null, depreciationMonths: null, monthlyPaymentCents: 50000 })).toBe(75000);
    expect(fixedMonthlyCents({ ...base, purchasePriceCents: null, depreciationMonths: null })).toBe(25000);
  });
});

describe("storeRows", () => {
  it("adds each store's revenue and costs and keeps untagged lines apart", () => {
    const rows = [
      line("irvine", "4010", "REVENUE", 325080),
      line("irvine", "4930", "CONTRA_REVENUE", -211180),
      line("irvine", "5010", "COST", -110084),
      line("irvine", "4080", "REVENUE", 5000),
      line("irvine", "6050", "EXPENSE", -7000),
      line(null, "6110", "EXPENSE", -56970),
      line("gone", "6130", "EXPENSE", -1000),
    ];
    expect(storeRows(rows, ["irvine", "pasadena"])).toEqual([
      { locationId: "irvine", revenue: 113900, costs: 110084 + 7000 - 5000, contribution: 113900 + 5000 - 110084 - 7000 },
      { locationId: null, revenue: 0, costs: 57970, contribution: -57970 },
    ]);
    expect(storeRows([], ["irvine"])).toEqual([]);
  });
});

describe("cashView", () => {
  const report: CashReport = {
    accounts: { "1050": -66, "1060": 10000, "2200": -40000, "2210": -8000, "2920": -500 },
    orders: { receivable: 12000, receivableOrders: 2, overdueDays: 9, prepaid: 30000, credits: 700 },
    bank: { total: 500000, latest: "2026-11-20", oldest: "2026-11-18", accounts: 2 },
    flows: [
      { month: "2026-08", net: -90000 },
      { month: "2026-09", net: -60000 },
      { month: "2026-10", net: -30000 },
    ],
    firstDate: "2026-07-15",
    owners: { count: 1, cents: 15000, oldest: "2026-11-21T18:00:00Z", nextSettle: "2026-11-27T08:00:00Z" },
    holds: { count: 1, cents: 50000 },
    pending: { exceptions: 2, approvals: 1 },
  };

  it("adds Stripe, transit and the typed bank balance", () => {
    const view = cashView(report, "2026-11-24");
    expect(view.total).toBe(-66 + 10000 + 500000);
    expect(view.bankAsOf).toBe("2026-11-18");
    expect(view.burn).toBe(60000);
    expect(view.runwayMonths).toBeCloseTo((-66 + 10000 + 500000) / 60000, 6);
  });

  it("counts due expenses with exceptions and approvals as pending", () => {
    const base = cashView(report, "2026-11-24").pending;
    expect(cashView({ ...report, pending: { ...report.pending, due: 3 } }, "2026-11-24").pending).toBe(base + 3);
  });

  it("hides the runway until three full months of books", () => {
    expect(cashView({ ...report, firstDate: "2026-08-02" }, "2026-11-24").runwayMonths).toBeNull();
    expect(cashView({ ...report, flows: report.flows.map((flow) => ({ ...flow, net: 10000 })) }, "2026-11-24").runwayMonths).toBeNull();
  });

  it("reads balances owed to customers and owners", () => {
    const view = cashView({ ...report, bank: { total: 0, latest: null, oldest: null, accounts: 0 } }, "2026-11-24");
    expect(view.bank).toBeNull();
    expect(view.total).toBe(9934);
    expect(view.credits).toBe(1200);
    expect(view.ownersPayable).toBe(48000);
    expect(view.ownersNextDue).toBe("2026-11-21");
    expect(view.pending).toBe(3);
    expect(view.holds).toBe(50000);
  });
});

describe("tables", () => {
  it("lists every channel and puts unknown ones under other", () => {
    const rows = channelRows([line("WEB", "4010", "REVENUE", 1000), line(null, "4070", "REVENUE", 200)], [{ source: "WEB", orders: 2, days: 5 }]);
    expect(rows.map((row) => row.source)).toEqual(["WEB", "STAFF", "PHONE", "WECHAT", null]);
    expect(rows[0]).toEqual({ source: "WEB", revenue: 1000, orders: 2, days: 5 });
    expect(rows[4].revenue).toBe(200);
    expect(channelRows([], []).length).toBe(4);
  });

  it("groups vehicles by class", () => {
    const result = period(firstOrder, [car({ id: "v1", serviceDays: 10, rentedDays: 5 }), car({ id: "v2", serviceDays: 10, rentedDays: 0, downDays: 2 }), car({ id: "v3", classId: "c2", className: "Cybertruck", classNameZh: null, serviceDays: 10 })]);
    const classes = classRows(result.rows);
    expect(classes[0]).toMatchObject({ classId: "c1", nameZh: "Model Y 标准", revenue: 197900, rentedDays: 5, availableDays: 18, vehicles: 2 });
    expect(classes[0].occupancy).toBeCloseTo(5 / 18, 6);
    expect(classes[1]).toMatchObject({ classId: "c2", nameZh: "Cybertruck", revenue: 0 });
  });

  it("breaks a total down by account", () => {
    expect(breakdown(firstOrder, ["REVENUE", "CONTRA_REVENUE"], 1).map((row) => [row.account, row.cents])).toEqual([
      ["4010", 325080],
      ["4020", 84000],
      ["4930", -211180],
    ]);
    expect(breakdown(firstOrder, ["COST"], -1).map((row) => row.cents)).toEqual([110084, 5769]);
  });

  it("describes changes", () => {
    expect(moneyChange(150, 100)).toEqual({ kind: "pct", value: 0.5 });
    expect(moneyChange(-50, -100)).toEqual({ kind: "pct", value: 0.5 });
    expect(moneyChange(10, 0)).toBeNull();
    expect(rateChange(0.4, 0.25)).toEqual({ kind: "pp", value: 0.15000000000000002 });
    expect(rateChange(null, 0.2)).toBeNull();
  });
});
