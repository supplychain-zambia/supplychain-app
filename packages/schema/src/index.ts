import { z } from "zod";

export const EVENT_TYPES = ["receipt", "dispense", "loss", "adjustment", "count", "transfer_out", "transfer_in"] as const;
export const LOSS_REASONS = ["expiry", "theft", "damage", "other"] as const;
export const ROLES = ["facility", "district", "province", "national", "admin"] as const;

/** One stock movement captured at a facility. Quantity is a whole number of dispensing units. */
export const StockEventInput = z
  .object({
    clientId: z.string().uuid(), // generated on the device; makes retries safe
    facilityId: z.string().uuid(),
    productId: z.string().uuid(),
    type: z.enum(EVENT_TYPES),
    quantity: z.number().int(), // signed only for adjustments
    reasonCode: z.string().min(1).max(40).optional(),
    batchNo: z.string().max(60).optional(),
    expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    deviceId: z.string().max(80).optional(),
  })
  .superRefine((e, ctx) => {
    if (e.type !== "adjustment" && e.quantity < 0) {
      ctx.addIssue({ code: "custom", path: ["quantity"], message: "Quantity cannot be negative" });
    }
    if ((e.type === "loss" || e.type === "adjustment") && !e.reasonCode) {
      ctx.addIssue({ code: "custom", path: ["reasonCode"], message: "A reason is required for losses and adjustments" });
    }
    if (e.type === "loss" && e.reasonCode && !(LOSS_REASONS as readonly string[]).includes(e.reasonCode)) {
      ctx.addIssue({ code: "custom", path: ["reasonCode"], message: "Loss reason must be expiry, theft, damage or other" });
    }
  });
export type StockEventInput = z.infer<typeof StockEventInput>;

export const SyncBatch = z.object({ events: z.array(StockEventInput).min(1).max(200) });

export const AuthClaims = z.object({
  sub: z.string().uuid(),
  role: z.enum(ROLES),
  scope: z.string().uuid(), // org unit the user may see (facility, district, province or national)
});
export type AuthClaims = z.infer<typeof AuthClaims>;

const password = z.string().min(10, "Use at least 10 characters").max(200);
export const LoginInput = z.object({ email: z.string().email(), password: z.string().min(1).max(200) });
export const ChangePasswordInput = z.object({ oldPassword: z.string().min(1), newPassword: password });
export const NewUserInput = z.object({
  email: z.string().email(),
  role: z.enum(ROLES),
  orgUnitId: z.string().uuid(),
  password, // temporary; the user must change it at first login
});
