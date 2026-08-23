#!/bin/sh
# Runs once on first cluster initialisation (docker-entrypoint-initdb.d).
# Creates the same least-privilege roles the Supabase setup used:
#   ti_shop_migrator — owns schema app, runs prisma migrate / seed / imports
#   ti_shop_app      — runtime role; table grants are applied after restore
set -eu
psql -v ON_ERROR_STOP=1 -U postgres -d ti_shop <<EOSQL
create role ti_shop_migrator login password '${TI_SHOP_MIGRATOR_PASSWORD}'
  nosuperuser nocreatedb nocreaterole noreplication;
create role ti_shop_app login password '${TI_SHOP_APP_PASSWORD}'
  nosuperuser nocreatedb nocreaterole noreplication;
grant connect, create on database ti_shop to ti_shop_migrator;
grant connect on database ti_shop to ti_shop_app;
EOSQL
