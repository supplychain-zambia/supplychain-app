alter table app_user
  add column password_hash text,
  add column failed_attempts integer not null default 0,
  add column locked_until timestamptz,
  add column must_change_password boolean not null default true;
