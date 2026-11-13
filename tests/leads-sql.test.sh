#!/usr/bin/env bash
# Exercises supabase/leads.sql on a local Postgres with a stubbed Supabase auth
# schema (roles anon/authenticated, auth.jwt() from a session setting).
# Usage: PSQL="psql -U postgres" tests/leads-sql.test.sh
set -euo pipefail
cd "$(dirname "$0")/.."
PSQL=${PSQL:-psql}
DB=gh_leads_test
$PSQL -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
run() { $PSQL -q -v ON_ERROR_STOP=1 -d $DB "$@"; }
run <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
create schema auth;
create function auth.jwt() returns jsonb language sql stable as
  $f$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $f$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.jwt() to anon, authenticated;
grant usage on schema public to anon, authenticated;
SQL
run -f supabase/leads.sql
run -f supabase/leads.sql   # re-runnable
run <<'SQL'
insert into gh_operators values ('op@example.com');
SQL

fail=0
expect_ok()  { if run -c "$2" >/dev/null 2>&1; then echo "ok   - $1"; else echo "FAIL - $1"; run -c "$2" || true; fail=1; fi; }
expect_err() { if run -c "$2" >/dev/null 2>&1; then echo "FAIL - $1 (should have been refused)"; fail=1; else echo "ok   - $1"; fi; }
ANON="set role anon;"
OP="set role authenticated; set request.jwt.claims = '{\"email\":\"op@example.com\"}';"
STRANGER="set role authenticated; set request.jwt.claims = '{\"email\":\"x@example.com\"}';"
L1="'11111111-1111-4111-8111-111111111111'"
L2="'22222222-2222-4222-8222-222222222222'"
ins() { echo "insert into gh_leads (id, ref, name, phone, job, category, consent $2) values ($1, 'GH-261113-AB$3', 'Jo Bloggs', '07700 900000', 'Mount a TV on plasterboard', 'Mounting / fittings', true $4);"; }

expect_ok  "anon can insert a lead"                  "$ANON $(ins "$L1" '' 'C1' '')"
expect_ok  "status forced to NEW even if sent APPROVED" "$ANON $(ins "$L2" ', status, decided_by, decided_at' 'C2' ", 'APPROVED', 'x', now()")"
expect_err "anon cannot read leads"                  "$ANON select 1/count(*) from gh_leads"
expect_err "anon cannot update leads"                "$ANON update gh_leads set status='APPROVED'"
expect_err "anon cannot call decide"                 "$ANON select gh_decide_lead($L1,'APPROVED')"
expect_err "consent required"                        "$ANON insert into gh_leads (ref,name,phone,job,category,consent) values ('GH-261113-ABC3','Jo','0770090000','Mount a TV here','Other',false)"
expect_err "phone or email required"                 "$ANON insert into gh_leads (ref,name,job,category,consent) values ('GH-261113-ABC4','Jo','Mount a TV here','Other',true)"
expect_err "non-operator cannot read leads"          "$STRANGER select 1/count(*) from gh_leads"
expect_err "non-operator cannot decide"              "$STRANGER select gh_decide_lead($L1,'APPROVED')"
expect_ok  "operator reads leads (2, both NEW)"       "$OP select 1/(count(*) filter (where status='NEW') - 1) from gh_leads"
expect_err "operator cannot update directly"         "$OP update gh_leads set status='APPROVED' where id=$L1"
expect_err "reject needs a note"                     "$OP select gh_decide_lead($L2,'REJECTED','  ')"
expect_ok  "operator approves"                       "$OP select gh_decide_lead($L1,'APPROVED')"
expect_err "cannot decide twice"                     "$OP select gh_decide_lead($L1,'REJECTED','changed mind')"
expect_ok  "operator rejects with note"              "$OP select gh_decide_lead($L2,'REJECTED','Outside service area')"
expect_ok  "decision stamped with operator email"    "$OP select 1/count(*) from gh_leads where id=$L1 and status='APPROVED' and decided_by='op@example.com' and decided_at is not null"
expect_ok  "audit log has NEW + decision per lead"   "$OP select 1/(count(*)-3) from gh_lead_events"
exit $fail
