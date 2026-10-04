# ADR 0001: Pilot architecture

- Modular monolith in TypeScript. API on Netlify Functions, PWA on Netlify, PostgreSQL on Neon (free tier for the pilot).
- Append-only `stock_event` ledger. Balances, AMC and MOS are derived, never stored as typed values.
- Business rules live in `packages/rules` and are shared by client and server. Policy version `zm-arv-sop-1` follows the Zambia ARV logistics SOP (AMC = latest 3 clean months, rounded up; MOS to one decimal; max 3 months; emergency point 0.5 months).
- Row-level security scopes every query to the caller's organisational unit. The API runs queries as the low-privilege role `scsp_app`.
- Idempotent sync using client-generated UUIDs; batches of at most 200 events.
- Aggregate commodity data only. No patient identifiers anywhere in the schema.
- Portability: standard Postgres, plain Hono app, no platform-specific storage. Hosting is revisited after the Muchinga pilot.

## Open assumptions
- The Essential Medicines SOP has not been reviewed; policies are per product class and may differ.
- Emergency status is "at or below 0.5 months".
