# Lead intake

Website enquiries become structured leads, a person approves or rejects each one, and every decision is logged.

```
Get a quote form ──▶ gh_leads (NEW) ──▶ /leads.html ──▶ APPROVED (ready to quote)
 index.html            Supabase         operator           └─▶ REJECTED (note required)
                                         sign-in             every step in gh_lead_events
```

## Capability labels

| Capability | Label | Notes |
|---|---|---|
| Enquiry form: validation, consent, spam trap | **REAL** | `index.html` quote modal |
| Lead storage | **DEMO** until configured, then **REAL** | DEMO keeps leads in the visitor's browser only |
| Operator sign-in | **DEMO** until configured, then **REAL** | Supabase Auth, email + password, allow-list in `gh_operators` |
| Approval step: approve / reject with note, audit log | **DEMO** until configured, then **REAL** | Enforced in the database by `gh_decide_lead()` |
| Category suggestion | **DEMO** | Keyword rules only; the operator sees it marked GUESS |
| New-lead notification (email / WhatsApp) | **PENDING** | Needs a real contact number and a sender |
| Photo upload | **PENDING** | Supabase Storage bucket, follow-up |
| Jobs board | **PENDING** | See follow-ups below |
| Proof (before/after, reviews) | **PENDING** | See follow-ups below |

The console at `/leads.html` shows these labels live under "What is real here".

## Switch it on (about 10 minutes)

1. Create a Supabase project (EU region, e.g. London).
2. SQL editor: run `supabase/leads.sql`. It is safe to re-run.
3. Authentication → Users: add each operator with a password. Turn off public sign-ups.
4. SQL editor: `insert into public.gh_operators (email) values ('operator@example.com');` for each operator.
5. Project settings → API: copy the Project URL and the `anon` public key into `assets/js/gh-config.js`.
6. Push. The form now sends to Supabase and `/leads.html` asks operators to sign in.

The anon key is meant to be public. Row-level security lets it insert a NEW lead and nothing else: it cannot read, change or delete leads. Only listed operators can read leads, and the only way a lead leaves NEW is `gh_decide_lead()`, which stamps the operator's email and time and writes an event.

Personal data lives in Supabase only, never in this public repo.

## Tests

```bash
npm test                                   # lead model, validation, both stores (Node 20+)
npm run test:e2e                           # browser: form → console → approve (needs Playwright)
PSQL="psql -U postgres" npm run test:sql   # schema + RLS on a local Postgres with stubbed Supabase auth
```

## Follow-ups (sketch)

**Notify on new lead (PENDING).** Supabase database webhook on `gh_leads` insert → edge function → email to the operator (Resend) or WhatsApp Cloud API once the real number exists. Message carries the reference only; details stay behind sign-in.

**Jobs (PENDING).** An APPROVED lead gets a "Create job" action that inserts `gh_jobs` (lead_id, scope, quoted_price, quote_approved_by, scheduled_for, status `QUOTED → BOOKED → IN_PROGRESS → COMPLETED → INVOICED → PAID`). The quote price must be approved by a person before the job can move to BOOKED, using the same pattern as `gh_decide_lead()`: a definer function, operator check, and an event row.

**Proof (PENDING).** `gh_job_media` (job_id, kind `before|after`, storage path, consent_to_publish, approved_by). A completed job can only show on the public site when the customer consented and an operator approved the specific photos. Reviews are linked to a real job ID so they cannot be invented.

**Rapid page.** `/rapid` still uses call/WhatsApp buttons with a placeholder number. Once the number is real, add the same form with `source: 'rapid'` and urgency preset to "Urgent (24h)".
