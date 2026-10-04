import { describe, expect, it } from "vitest";
import { averageMonthlyConsumption, monthsOfStock, orderQuantity, stockStatus, type MonthRecord } from "./index";

const m = (month: string, consumption: number | null, stockedOut = false): MonthRecord => ({ month, consumption, stockedOut });

describe("AMC (SOP: 3 clean months, round up)", () => {
  it("averages the latest three months", () => {
    expect(averageMonthlyConsumption([m("2026-07", 90), m("2026-08", 96), m("2026-09", 102)])).toBe(96);
  });
  it("always rounds up", () => {
    expect(averageMonthlyConsumption([m("2026-07", 100), m("2026-08", 100), m("2026-09", 101)])).toBe(101);
  });
  it("skips stock-out months and uses the next most recent clean month", () => {
    const data = [m("2026-06", 60), m("2026-07", 90), m("2026-08", 5, true), m("2026-09", 120)];
    expect(averageMonthlyConsumption(data)).toBe(90); // (120 + 90 + 60) / 3
  });
  it("uses whatever data exists when fewer than three months", () => {
    expect(averageMonthlyConsumption([m("2026-09", 50)])).toBe(50);
  });
  it("treats unreported months as unknown, not zero", () => {
    expect(averageMonthlyConsumption([m("2026-08", null), m("2026-09", 80)])).toBe(80);
    expect(averageMonthlyConsumption([m("2026-09", null)])).toBeNull();
  });
  it("does not depend on input order", () => {
    expect(averageMonthlyConsumption([m("2026-09", 120), m("2026-07", 60), m("2026-08", 90)])).toBe(90);
  });
});

describe("Months of stock (SOP: one decimal)", () => {
  it("rounds 3.22 to 3.2 and 1.88 to 1.9", () => {
    expect(monthsOfStock(322, 100)).toBe(3.2);
    expect(monthsOfStock(188, 100)).toBe(1.9);
  });
  it("returns null without a usable AMC", () => {
    expect(monthsOfStock(100, null)).toBeNull();
    expect(monthsOfStock(100, 0)).toBeNull();
  });
});

describe("Status and ordering (max 3 months, emergency 0.5)", () => {
  it("classifies stock status", () => {
    expect(stockStatus(0, 100)).toBe("stocked_out");
    expect(stockStatus(50, 100)).toBe("emergency");
    expect(stockStatus(200, 100)).toBe("below_max");
    expect(stockStatus(400, 100)).toBe("overstocked");
    expect(stockStatus(200, null)).toBe("unknown");
  });
  it("orders up to maximum, never negative", () => {
    expect(orderQuantity(100, 96)).toBe(188); // 3 x 96 = 288, minus 100
    expect(orderQuantity(500, 96)).toBe(0);
    expect(orderQuantity(100, null)).toBe(0);
  });
});
