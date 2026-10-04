/**
 * Stock rules shared by the offline client and the server.
 * Source: Republic of Zambia, Management of the National ARV Logistics System (SOP).
 * Policy version is recorded with every computed value so rules can evolve safely.
 * NOTE: the Essential Medicines SOP has not been reviewed yet; policies are per product class.
 */
export interface StockPolicy {
  version: string;
  amcMonths: number; // number of clean months averaged
  maxMonths: number; // maximum months of stock
  emergencyMonths: number; // emergency order point (months)
}

export const ARV_SOP_POLICY: StockPolicy = {
  version: "zm-arv-sop-1",
  amcMonths: 3,
  maxMonths: 3,
  emergencyMonths: 0.5, // 2 weeks
};

export interface MonthRecord {
  month: string; // YYYY-MM
  consumption: number | null; // null = not reported (unknown, never zero)
  stockedOut: boolean;
}

/**
 * AMC per SOP: average of the latest complete months, skipping any month with a stock-out
 * (use the next most recent clean month instead). With fewer months than required, use what
 * exists. Result is always rounded UP to a whole number. Returns null if no usable data.
 */
export function averageMonthlyConsumption(
  months: MonthRecord[],
  policy: StockPolicy = ARV_SOP_POLICY,
): number | null {
  const usable = months
    .filter((m) => m.consumption !== null && !m.stockedOut)
    .sort((a, b) => (a.month < b.month ? 1 : -1)) // newest first
    .slice(0, policy.amcMonths);
  if (usable.length === 0) return null;
  const sum = usable.reduce((s, m) => s + (m.consumption as number), 0);
  return Math.ceil(sum / usable.length);
}

/** Months of stock on hand, one decimal place (standard rounding). Null if AMC is missing or zero. */
export function monthsOfStock(stockOnHand: number, amc: number | null): number | null {
  if (amc === null || amc <= 0) return null;
  return Math.round((stockOnHand / amc + Number.EPSILON) * 10) / 10;
}

export type StockStatus = "stocked_out" | "emergency" | "below_max" | "overstocked" | "unknown";

export function stockStatus(
  stockOnHand: number,
  amc: number | null,
  policy: StockPolicy = ARV_SOP_POLICY,
): StockStatus {
  if (stockOnHand <= 0) return "stocked_out";
  const mos = monthsOfStock(stockOnHand, amc);
  if (mos === null) return "unknown";
  if (mos <= policy.emergencyMonths) return "emergency"; // assumption: at or below the point
  if (mos > policy.maxMonths) return "overstocked";
  return "below_max";
}

/** Forced-ordering (order up to maximum). Never negative; rounded up. */
export function orderQuantity(
  stockOnHand: number,
  amc: number | null,
  policy: StockPolicy = ARV_SOP_POLICY,
): number {
  if (amc === null) return 0;
  return Math.max(0, Math.ceil(policy.maxMonths * amc) - stockOnHand);
}
