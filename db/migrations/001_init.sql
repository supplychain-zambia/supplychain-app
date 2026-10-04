-- SCSP initial schema. Aggregate commodity data only: no patient identifiers.

create type org_level as enum ('national', 'province', 'district', 'facility');
create type event_type as enum ('receipt', 'dispense', 'loss', 'adjustment', 'count', 'transfer_out', 'transfer_in');
create type report_type as enum ('weekly', 'monthly');
create type transfer_status as enum ('issued', 'in_transit', 'received', 'rejected');
create type user_role as enum ('facility', 'district', 'province', 'national', 'admin');

create table org_unit (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references org_unit(id),
  level org_level not null,
  name text not null,
  code text unique,
  path text not null unique, -- dotted ancestry, e.g. zm.muchinga.mpika.chilonga
  active boolean not null default true
);

create table product (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  dispensing_unit text not null,
  active boolean not null default true
);

-- Per-facility stock policy (months). Defaults follow the ARV SOP; override per product class.
create table facility_product (
  facility_id uuid not null references org_unit(id),
  product_id uuid not null references product(id),
  max_months numeric(4,1) not null default 3,
  emergency_months numeric(4,1) not null default 0.5,
  policy_version text not null default 'zm-arv-sop-1',
  primary key (facility_id, product_id)
);

create table app_user (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  role user_role not null,
  org_unit_id uuid not null references org_unit(id),
  active boolean not null default true
);

-- Append-only ledger. Balances, AMC and MOS are derived, never typed in.
create table stock_event (
  id bigint generated always as identity primary key,
  client_id uuid not null unique, -- idempotency key from the device
  facility_id uuid not null references org_unit(id),
  product_id uuid not null references product(id),
  event_type event_type not null,
  quantity integer not null,
  reason_code text,
  batch_no text,
  expiry_date date,
  occurred_on date not null,
  recorded_by uuid, -- app_user.id (not a foreign key so development tokens work)
  device_id text,
  received_at timestamptz not null default now(),
  constraint reason_required check (event_type not in ('loss', 'adjustment') or reason_code is not null),
  constraint non_negative check (event_type = 'adjustment' or quantity >= 0)
);
create index stock_event_facility_product_date on stock_event (facility_id, product_id, occurred_on);

create table report (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references org_unit(id),
  report_type report_type not null,
  period_start date not null,
  version integer not null default 1,
  submitted_at timestamptz not null default now(),
  submitted_by uuid,
  superseded boolean not null default false, -- resubmission supersedes, never overwrites
  unique (facility_id, report_type, period_start, version)
);

create table transfer (
  id uuid primary key default gen_random_uuid(),
  from_facility_id uuid not null references org_unit(id),
  to_facility_id uuid not null references org_unit(id),
  product_id uuid not null references product(id),
  quantity integer not null check (quantity > 0),
  status transfer_status not null default 'issued',
  issued_at timestamptz not null default now(),
  received_at timestamptz,
  check (from_facility_id <> to_facility_id)
);

create table audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,
  action text not null,
  detail jsonb not null default '{}'
);

-- Immutability for ledger and audit log.
create function forbid_mutation() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name;
end $$;
create trigger stock_event_immutable before update or delete on stock_event
  for each row execute function forbid_mutation();
create trigger audit_log_immutable before update or delete on audit_log
  for each row execute function forbid_mutation();

-- Row-level security: a user only sees rows inside their organisational scope.
do $$ begin
  if not exists (select from pg_roles where rolname = 'scsp_app') then
    create role scsp_app nologin;
  end if;
end $$;
grant scsp_app to current_user;

create function in_scope(unit uuid) returns boolean language sql stable as $$
  select exists (
    select 1
    from org_unit u
    join org_unit s on s.id = nullif(current_setting('app.scope_unit', true), '')::uuid
    where u.id = unit and (u.path = s.path or u.path like s.path || '.%')
  )
$$;

alter table stock_event enable row level security;
alter table stock_event force row level security;
create policy stock_event_scope on stock_event
  using (in_scope(facility_id)) with check (in_scope(facility_id));

alter table report enable row level security;
alter table report force row level security;
create policy report_scope on report
  using (in_scope(facility_id)) with check (in_scope(facility_id));

alter table transfer enable row level security;
alter table transfer force row level security;
create policy transfer_scope on transfer
  using (in_scope(from_facility_id) or in_scope(to_facility_id))
  with check (in_scope(from_facility_id) or in_scope(to_facility_id));

grant usage on schema public to scsp_app;
grant select on org_unit, product, facility_product to scsp_app;
grant select, insert on stock_event, report to scsp_app;
grant select, insert, update on transfer to scsp_app;
grant insert on audit_log to scsp_app;
grant usage on all sequences in schema public to scsp_app;
