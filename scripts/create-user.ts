// Bootstrap the first admin: npm run create-user -- <email> <role> <orgUnitCode> <temporaryPassword>
import postgres from "postgres";
import { hashPassword } from "../netlify/functions/lib/password";

const [email, role, unitCode, password] = process.argv.slice(2);
const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!email || !role || !unitCode || !password || !url) throw new Error("usage: create-user <email> <role> <orgUnitCode> <password>");
if (password.length < 10) throw new Error("Password must be at least 10 characters");

const sql = postgres(url, { max: 1 });
const [u] = await sql`select id from org_unit where code = ${unitCode}`;
if (!u) throw new Error(`Org unit ${unitCode} not found`);
await sql`insert into app_user (email, role, org_unit_id, password_hash)
          values (${email.toLowerCase()}, ${role}::user_role, ${u.id}, ${hashPassword(password)})`;
console.log("user created; they must change the password at first login");
await sql.end();
