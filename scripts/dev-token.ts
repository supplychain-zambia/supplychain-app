// Development/staging only. Usage: JWT_SECRET=... npx tsx scripts/dev-token.ts <userUuid> <role> <scopeOrgUnitUuid>
import { SignJWT } from "jose";
const [sub, role, scope] = process.argv.slice(2);
const secret = process.env.JWT_SECRET;
if (!sub || !role || !scope || !secret) throw new Error("usage: see header of this file");
const token = await new SignJWT({ role, scope })
  .setProtectedHeader({ alg: "HS256" })
  .setSubject(sub)
  .setIssuer(process.env.JWT_ISSUER ?? "scsp")
  .setExpirationTime("12h")
  .sign(new TextEncoder().encode(secret));
console.log(token);
