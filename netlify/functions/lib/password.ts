import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("hex")}$${scryptSync(pw, salt, 64).toString("hex")}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [, s, h] = stored.split("$");
  if (!s || !h) return false;
  const a = scryptSync(pw, Buffer.from(s, "hex"), 64);
  const b = Buffer.from(h, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Verified when the account does not exist, so response time does not reveal valid emails. */
export const DUMMY_HASH = hashPassword("dummy-password-for-timing");
