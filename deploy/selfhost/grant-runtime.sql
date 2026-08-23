-- Run as ti_shop_migrator after a restore or migration so the runtime role
-- sees every object (identical policy to the Supabase bootstrap).
grant usage on schema app to ti_shop_app;
grant select, insert, update, delete on all tables in schema app to ti_shop_app;
grant usage, select on all sequences in schema app to ti_shop_app;
revoke update, delete, truncate on table app.audit_logs from ti_shop_app;
grant select, insert on table app.audit_logs to ti_shop_app;
alter default privileges for role ti_shop_migrator in schema app
  grant select, insert, update, delete on tables to ti_shop_app;
alter default privileges for role ti_shop_migrator in schema app
  grant usage, select on sequences to ti_shop_app;
