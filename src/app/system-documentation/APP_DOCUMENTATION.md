# ACSL Stove Sales & Transactions Platform — Handover Documentation

**Version:** 1.0  
**Last updated:** 2026-08-06  
**Audience:** A competent developer taking ownership of this codebase with no prior exposure to it.

This document is intended to be sufficient on its own to run, understand, deploy and maintain the application.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture](#2-architecture)
3. [Repository Structure](#3-repository-structure)
4. [Local Development Setup](#4-local-development-setup)
5. [Configuration and Environment Variables](#5-configuration-and-environment-variables)
6. [Data Model](#6-data-model)
7. [API Reference](#7-api-reference)
8. [Authentication and Authorisation](#8-authentication-and-authorisation)
9. [Third-Party Services and Dependencies](#9-third-party-services-and-dependencies)
10. [Deployment](#10-deployment)
11. [Operations and Troubleshooting](#11-operations-and-troubleshooting)
12. [Glossary](#12-glossary)

---

## 1. System Overview

The platform is the back-office and reporting system for **ACSL** (Atmosfair Clean Stoves), which manufactures and distributes clean cookstoves in Nigeria through a network of **partners** (distributor organisations) and **agents** (ACSL field staff).

### What the system does

| Capability | Description |
| --- | --- |
| Stove inventory tracking | Every physical stove has a unique **stove ID / serial number**. Stove IDs are imported from the factory/ERP, transferred to partners, and marked sold when a sale is recorded. |
| Sales capture | A multi-section sales form captures the buyer, the end user, the location (state/LGA), the stove serial, the payment model, stove/agreement images and a digital signature. |
| Installment payments | Sales can be outright or under an installment **payment model**. Payments are recorded against the sale, with balances, due dates and payment history. |
| End user records | A consolidated view (and a public API) of every end user who received a stove, used for carbon-credit reporting and verification. |
| Performance reporting | Dashboards and reports per agent, per partner and per state, including sell-through rates and records-collected charts. |
| User and access management | Creation and administration of super admins, ACSL agents, agent managers, partners and partner agents, with role-scoped visibility. |
| Reconciliation & sync | Scheduled/manual synchronisation with the external ERP and CSV sources to keep partners and stove IDs aligned. |

### Primary user journeys

~~~text
Factory / ERP ──► stove IDs imported ──► transferred to a partner
                                              │
                            partner / agent records a sale
                                              │
        ┌─────────────────────────────────────┼───────────────────────────┐
        ▼                                     ▼                           ▼
  stove ID marked "sold"            installment schedule            end user record
                                    + payment history               (API + reporting)
~~~

1. **Super admin** configures payment models, partners, users and system settings; sees everything.
2. **ACSL agent manager** oversees a set of agents; sees the sales and partners under those agents.
3. **ACSL agent** is assigned partners/states; records sales on behalf of partners and tracks collection.
4. **Partner** (organisation account) records its own sales and views its own performance.
5. **Partner agent** records sales for its partner organisation only.

---

## 2. Architecture

### High-level

~~~text
┌──────────────────────────────────────────────────────────────┐
│ Browser (React 19 SPA, SSR-capable via TanStack Start/Vite)  │
│  • TanStack Router (file-based routes in src/routes)         │
│  • Feature UI in src/app/<feature>                           │
│  • Supabase JS client (anon key, RLS-scoped)                 │
└───────────┬───────────────────────────┬──────────────────────┘
            │ direct PostgREST reads    │ HTTPS (JWT bearer)
            │ (RLS enforced)            │
            ▼                           ▼
┌───────────────────────┐   ┌────────────────────────────────────┐
│ Supabase Postgres     │◄──│ Supabase Edge Functions (Deno)     │
│  • tables + RLS       │   │  ~50 functions = the service layer │
│  • auth.users         │   │  run with SERVICE_ROLE (RLS bypass)│
│  • storage buckets    │   │  each re-verifies caller identity  │
└───────────────────────┘   └───────┬────────────────────────────┘
                                    │
              ┌─────────────────────┼──────────────────────┐
              ▼                     ▼                      ▼
      Google Maps/Places      Resend / Brevo         External ERP + CSV
      (geocoding, map)        (email delivery)       (partners, stove IDs)
~~~

### Key decisions and their consequences

- **Edge Functions are the write path.** Anything privileged (creating users, creating/updating/cancelling sales, managing stove IDs, admin dashboards) goes through an Edge Function that uses the service role key and performs its own authorisation check. The service role key never reaches the browser.
- **Direct PostgREST reads are the read path** for non-sensitive listings, protected by Row Level Security policies.
- **The frontend was migrated from Next.js to TanStack Start.** `src/compat/` contains thin shims (`Link`, `Image`, `navigation`) so legacy Next.js-style imports keep working. Do not reintroduce `next/*` imports; extend the shims instead.
- **SSR safety matters.** Supabase clients are lazily created behind a Proxy in `src/lib/supabaseClient.ts` so that importing a service at module scope during server rendering cannot throw `supabaseUrl is required`.
- **Client-side auth cache.** `src/lib/authCache.ts` and `profileService` cache the session/profile to avoid a network round-trip and a visible reload on every navigation.

### Sale creation flow

~~~text
CreateSalesForm (validation: NG phone format, unique end-user phone,
                 state/LGA cascade, signature/image capture)
        │
        ▼  POST /functions/v1/create-sale  (JWT of the signed-in user)
Edge Function create-sale
        ├─ verify caller + resolve organization_id
        ├─ re-check end-user phone uniqueness
        ├─ insert address, upload image references
        ├─ insert sales row (status, payment_model_id, is_installment…)
        ├─ mark stove_ids_base row as sold + link sale_id
        └─ write sales_history audit row
~~~

### Sale cancellation flow

~~~text
Delete/cancel action ──► reason is mandatory
   ├─ sales.is_archived = true, status = cancelled, reason stored
   ├─ stove ID released back to "available"
   └─ record appears in Cancelled Transactions with "Cancelled By"
~~~

---

## 3. Repository Structure

~~~text
.
├── src/
│   ├── routes/                    # TanStack Router file-based routes (thin wrappers)
│   │   ├── __root.tsx             # root layout, app shell, error boundary, chunk-reload guard
│   │   ├── index.tsx              # "/" → login/redirect
│   │   └── <feature>/index.tsx    # lazy-imports the matching page from src/app
│   ├── routeTree.gen.ts           # GENERATED — never edit by hand
│   ├── app/                       # all feature code (legacy Next.js "app" layout)
│   │   ├── components/            # DashboardLayout, Sidebar, TopNavigation,
│   │   │                          # ProtectedRoute, RoleGate, PageHeader, modals
│   │   ├── contexts/              # AuthContext, SidebarContext, ToastContext
│   │   ├── hooks/                 # usePermissions, useAdminSales, useOrganizations, …
│   │   ├── services/              # browser-side API clients calling Edge Functions
│   │   ├── utils/                 # salesFormUtils, validation, signature helpers
│   │   ├── dashboard/ sales/ partners/ agents/ stove-management/
│   │   ├── end-user-records/      # records view + /api documentation view
│   │   ├── settings/              # payment models, credentials, system config, tools
│   │   ├── user-management/       # users + user groups
│   │   └── system-documentation/  # this document
│   ├── compat/                    # Next.js compatibility shims (Link, Image, navigation)
│   ├── lib/                       # supabaseClient, supabaseConfig, permissions,
│   │                              # authCache, chunk-reload, pdfUtils, geoDataService
│   ├── components/ui/             # shadcn/Radix primitives
│   ├── types/                     # shared TypeScript types
│   └── styles.css                 # Tailwind v4 entry + theme tokens
├── supabase/
│   ├── functions/                 # Deno Edge Functions (one folder per function)
│   │   └── _shared/               # cors, auth helpers, deleteUserCleanup
│   ├── sql/                       # ad-hoc SQL scripts / migrations
│   ├── SUPABASE_TABLE_OVERVIEW.md # snapshot of tables, constraints and RLS policies
│   └── config.toml
├── ACCESS_CONTROL.md              # role/route access matrix
├── .env.example
├── vite.config.ts
└── package.json
~~~

**Convention:** a route file in `src/routes` should contain only `createFileRoute` plus a lazy import. All real UI lives under `src/app`.

---

## 4. Local Development Setup

### Prerequisites

- **Bun** 1.3+ (package manager and runner). Node 20+ works for tooling but the lockfile is Bun's.
- **Supabase CLI** (only needed to deploy or serve Edge Functions locally).
- Access to the Supabase project (URL, anon key) and, for function deployment, the project ref and access token.

### Steps

~~~bash
git clone <repo-url>
cd frontend-transactions
bun install

cp .env.example .env.local     # then fill in the values (see section 5)

bun run dev                    # Vite dev server, http://localhost:8080
~~~

Other scripts:

~~~bash
bun run build        # production build
bun run build:dev    # development-mode build (useful to reproduce prerender errors)
bun run preview      # serve the production build locally
bun run lint         # eslint
bun run format       # prettier
~~~

### Working on Edge Functions

~~~bash
supabase login
supabase link --project-ref <project-ref>

supabase functions serve create-sale --env-file supabase/.env   # run locally
supabase functions deploy create-sale                            # deploy one
supabase functions deploy                                        # deploy all
supabase secrets set END_USER_RECORDS_API_KEY=...                # set a secret
supabase secrets list
~~~

### Common startup failures

| Symptom | Cause | Fix |
| --- | --- | --- |
| `supabaseUrl is required` | Env vars missing, or a service created a client at module scope | Fill `.env.local`; keep Supabase client creation lazy |
| Blank page, `no matching route` | `createFileRoute` string does not match the file path | Fix the route file; never edit `routeTree.gen.ts` |
| 404s on `/assets/*.js` after a deploy | Browser holding a stale `index.html` | Handled automatically by `src/lib/chunk-reload.ts` (single guarded reload) |
| Edge Function 401 | Missing/expired JWT in the request | Re-login; check the service wrapper attaches the session token |

---

## 5. Configuration and Environment Variables

### Client-side (Vite, exposed in the browser bundle — must be publishable values only)

| Variable | Required | Used by | Notes |
| --- | --- | --- | --- |
| `VITE_SUPABASE_URL` | Yes | `src/lib/supabaseConfig.ts` | Project URL, e.g. `https://xxxx.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Yes | `src/lib/supabaseConfig.ts` | Anon/publishable key; RLS enforced |
| `VITE_GOOGLE_MAPS_API_KEY` | For the Map view | `src/app/map` | Restrict by HTTP referrer in Google Cloud |
| `VITE_GOOGLE_PLACES_API_KEY` | For address autocomplete | sales form | May be the same key with Places enabled |

`supabaseConfig.ts` reads `import.meta.env` first and falls back to `process.env`, so the same values work during SSR/build.

### Server-side (Supabase Edge Function secrets — never in the repo)

| Secret | Purpose |
| --- | --- |
| `SUPABASE_URL` | Injected by the platform |
| `SUPABASE_ANON_KEY` | Injected by the platform |
| `SUPABASE_SERVICE_ROLE_KEY` | Injected by the platform; grants RLS bypass inside functions |
| `END_USER_RECORDS_API_KEY` | Bearer key for the public End User Records API |
| `RESEND_API_KEY` / `email_config.resend_api_key` | Transactional email |
| `BREVO_API_KEY` / `app_settings.brevo_api_key` | Legacy email provider |
| `GOOGLE_MAPS_API_KEY`, `GOOGLE_PLACES_API_KEY` | Served to the client via `get-google-keys`; also stored in `app_settings` |
| External sync credentials | Used by `external-sync` / `external-csv-sync` / `reconcile-*` |

Some keys are stored in the database (`app_settings`, `email_config`) so super admins can rotate them from **Settings → System Configuration** without a redeploy. Edge Functions read the DB value first and fall back to the environment secret.

**Rule:** anything prefixed `VITE_` is public. Never place a service role key or a provider secret behind a `VITE_` name.

---

## 6. Data Model

The authoritative snapshot lives in `supabase/SUPABASE_TABLE_OVERVIEW.md` (columns, constraints and RLS policies). Regenerate it after schema changes.

### Entity relationships

~~~text
auth.users 1─1 profiles ──────────────┐
                │ organization_id     │ manager_id (agent → manager)
                ▼                     │
          organizations  ◄────────────┘
             │   │   │
             │   │   └── organization_payment_models ──► payment_models
             │   └────── acsl_agent_organizations ────► profiles (agent)
             │           acsl_agent_states  (state coverage per agent)
             ▼
          stove_ids_base ──sale_id──► sales ◄── installment_payments
                                        │  │
                                        │  ├── addresses (address_id)
                                        │  ├── sales_images / uploads
                                        │  │   (stove_image_id, agreement_image_id)
                                        │  └── sales_history (audit trail)
                                        ▼
                              stove_transfer_history (partner purchases from ACSL)
~~~

### Core tables

**profiles** — one row per application user, mirrors `auth.users`.  
`id, email, full_name, phone, role, username, status, organization_id, manager_id, has_changed_password, last_login, updated_by, created_at, updated_at`  
RLS: users read/update their own row; super admins update any; service role full access.

**organizations** — partners (distributors).  
`id, partner_id, partner_name, partner_type, contact_person, contact_phone, alternative_phone, email, address, state, branch, manually_edited, created_by, updated_by, created_at, updated_at`  
RLS: super admin and admin full access; authenticated users can read.

**sales** — the central transaction table.  
`id, transaction_id, stove_serial_no, sales_date, organization_id, created_by, sold_on_behalf_of, partner_name, retailer_branch, contact_person, contact_phone, end_user_name, aka, phone, other_phone, address_id, state_backup, lga_backup, amount, payment_model_id, is_installment, total_paid, payment_status, status, agent_approved, agent_approved_at, agent_approved_by, signature, stove_image_id, agreement_image_id, terms_accepted, is_archived, platform, pot_quantity, heat_retention_device, previous_stove_type, previous_stove_other, meals_per_day, cooking_fuel_source, cooking_location, created_at`  
RLS: users see their own sales and their organisation's sales; super admins and the service role see all.

**stove_ids_base** — stove inventory.  
`id, stove_id, organization_id, status, sale_id, factory, sales_reference, transfer_sales_date, is_archived, archive_note, created_at`

Stove ID lifecycle:

~~~text
imported ──► available ──► (transferred to partner) ──► sold ──► (sale cancelled) ──► available
                                                          └────► archived (is_archived = true)
~~~

**payment_models** — `id, name, description, duration_months, fixed_price, min_down_payment, is_active, created_by`. Assigned to partners through **organization_payment_models**. If a partner has no assignment, the sales form falls back to showing all active models.

**installment_payments** — `id, sale_id, amount, payment_method, payment_date, proof_image_url, proof_image_id, notes, recorded_by, created_at`. Outstanding balance = model price − sum(amount).

**acsl_agent_organizations / acsl_agent_states** — which partners and which states an ACSL agent covers. State coverage in reports is also derived from the states of the linked partners.

**credentials** — login credentials issued to partners (username/email/password metadata) used by the `login-with-credentials` flow.

**sales_history** — audit trail: `sale_id, action_type, action_description, field_changes (jsonb), performed_by, performed_at, ip_address, user_agent`.

**stove_transfer_history** — records of stove batches purchased/transferred from ACSL to a partner, including `stove_ids` (jsonb array), `stove_count`, `source`, `sales_rep`.

**sync_logs** — one row per ERP/CSV sync run with counts of partners and stove IDs created/updated/skipped/failed and per-entry detail.

**Supporting tables:** `addresses`, `uploads`, `sales_images`, `app_settings`, `app_releases` (mobile APK releases), `email_config`, `email_logs`, `external_app_tokens` (tokens for external applications), `organizations_backup_20251002` (frozen backup, do not write).

### Sale status transitions

~~~text
draft/pending ──► active ──► completed          (all installments paid)
      │             │
      └─────────────┴────► cancelled (is_archived = true, reason recorded)
~~~

---

## 7. API Reference

All Edge Functions are served at:

~~~text
https://<project-ref>.supabase.co/functions/v1/<function-name>
~~~

Unless stated otherwise they require an `Authorization: Bearer <supabase-jwt>` header and an `apikey` header with the anon key, accept JSON, and return `{ success: boolean, data?: ..., error?: string }`.

### Sales

| Function | Method | Purpose | Access |
| --- | --- | --- | --- |
| `create-sale` | POST | Create a sale, link the stove ID, store images/signature, audit | Any authenticated sales role |
| `update-sale` | POST/PATCH | Update all editable fields of a sale (partner and serial stay locked) | Owner, admin, super admin |
| `delete-sale` | POST | Cancel/archive a sale, release the stove ID, record the reason | Admin, super admin |
| `approve-sale` | POST | Agent approval of a sale | Agent, manager, super admin |
| `get-sale` | GET/POST | Full detail of one sale including payments and images | Scoped by role |
| `get-sales-advanced` | POST | Paginated, filtered sales listing behind the reports views | Scoped by role |
| `installment-payments` | POST | Record a payment, list payment history, compute balances | Scoped by role |

### Stove IDs and transfers

`manage-stove-ids` (CRUD/import), `get-stove-ids`, `get-agent-stove-ids`, `get-stove-stats`, `stove-lookup`, `get-transfer-history`, `get-agreement-image-by-serial`.

### Users, profiles and access

`manage-users` (create/update/delete users, password reset via Auth Admin API), `manage-admin-users`, `manage-agents`, `manage-profile`, `manage-credentials`, `super-admin-agents`, `login-with-credentials` (public: sign in with username **or** email, returns a Supabase session).

### Organisations and payment models

`manage-organizations`, `get-organizations-grouped`, `get-organization-agents`, `get-sales-agents`, `payment-models`, `organization-payment-models`.

### Dashboards and reporting

`get-dashboard-stats`, `get-super-admin-dashboard`, `super-admin-agent-dashboard`, `get-end-user-phones`, `get-sync-logs`. (`get-super-admin-dashboard-old` is retained only for comparison and can be removed.)

### Sync and reconciliation

`external-sync`, `external-csv-sync`, `reconcile-erp-csv`, `reconcile-erp-full`, `reconcile-internal`, plus one-off backfills: `backfill-sale-status`, `backfill-sales-models`, `backfill-stove-fields`.

### Platform / settings

`manage-app-settings`, `manage-app-release`, `manage-app-tokens`, `get-google-keys`, `get-end-user-api-key`, `geo-data`, `refresh-geo-data`, `send-email-notification`, `hello-world` (health check).

### Public API — End User Records

Consumed by external partners for verification and carbon reporting. Documented in-app at **API Documentation**.

~~~http
GET /functions/v1/end-user-records-api?page=1&limit=50&state=Kano&lga=Kano%20Municipal
Authorization: Bearer <END_USER_RECORDS_API_KEY>
Content-Type: application/json
~~~

Query parameters: `page`, `limit`, `state`, `lga`, `start_date`, `end_date`, `search` (name/phone/serial), `partner_id`.

~~~json
{
  "success": true,
  "pagination": { "page": 1, "limit": 50, "total": 1284, "total_pages": 26 },
  "data": [
    {
      "transaction_id": "ASY1O4",
      "stove_serial_no": "101109216",
      "sales_date": "2026-05-12",
      "end_user_name": "James John",
      "phone": "08031234567",
      "aka": "Baba James",
      "contact_person": "James John",
      "contact_phone": "08031234567",
      "state": "Kano",
      "lga": "Kano Municipal",
      "address": "12 Zoo Road, Kano",
      "partner_name": "Swali Global Multi Concept",
      "amount": 45000,
      "payment_model": "Amina Sales Model",
      "cooking_fuel_source": "Firewood",
      "meals_per_day": "3",
      "created_at": "2026-05-12T10:14:22Z"
    }
  ]
}
~~~

Errors: `401` invalid/missing key, `500 END_USER_RECORDS_API_KEY not configured` when the secret is unset.

---

## 8. Authentication and Authorisation

### Sign-in

Two paths, both ending in a standard Supabase session:

1. **Email + password** via `supabase.auth.signInWithPassword` (`src/app/services/authService.js`).
2. **Username or email** via the `login-with-credentials` Edge Function, which resolves the identifier against `credentials`/`profiles`, authenticates server-side and returns `access_token` / `refresh_token`; the client then calls `supabase.auth.setSession(...)`.

After sign-in, `profileService.fetchAndStoreProfile()` loads the `profiles` row and caches it (also in `src/lib/authCache.ts`) so navigation does not re-fetch. `AuthContext` exposes `user`, `profile`, `role` and convenience flags (`isSuperAdmin`, `isAcslAgent`, `isAcslAgentManager`, `isPartner`, …). Sign-out clears both the Supabase session and the cached profile.

First-time users are prompted by `FirstTimePasswordChangeModal` when `has_changed_password` is false — **super admins are exempt**.

### Roles

| Role | Scope |
| --- | --- |
| `super_admin` | Unrestricted. `usePermissions` short-circuits every check to true. |
| `acsl_agent_manager` | Their agents, and the partners/sales under those agents. |
| `acsl_agent` | Their assigned partners (`acsl_agent_organizations`) and states; can sell on behalf of a partner. |
| `partner` | Their own organisation's sales, agents and performance. |
| `partner_agent` | Sales they create for their partner organisation. |

Legacy aliases (`admin`, `agent`, `agent_user`, `super_admin_agent`) are normalised by `resolveRole()` in `src/lib/permissions.ts`.

### Authorisation layers

~~~text
1. UI            Sidebar builds itself from canRoute(); RoleGate hides features
2. Route         ProtectedRoute (requireSuperAdmin / requireAdminAccess) guards pages
3. Edge Function Re-verifies the JWT and role server-side before any privileged write
4. Database      RLS policies scope rows by auth.uid() / organization_id
~~~

Never rely on layers 1–2 alone: they are UX, not security. Every Edge Function that uses the service role must authenticate the caller itself (see `supabase/functions/manage-admin-users/authenticate.ts` for the canonical pattern).

`src/lib/permissions.ts` defines `RouteKey` and `FeatureKey` unions and the role→permission matrix; `usePermissions()` exposes `can(feature)`, `canRoute(route)` and `isSuperAdmin`. Add new pages by adding a `RouteKey` and granting it to the appropriate roles — do not scatter role string comparisons through components. `ACCESS_CONTROL.md` holds the full matrix.

---

## 9. Third-Party Services and Dependencies

| Service | Used for | If the credential lapses |
| --- | --- | --- |
| **Supabase** | Postgres, Auth, Storage, Edge Functions | Total outage |
| **Vercel** | Hosting and CI for the frontend | No new deploys; live site keeps serving |
| **Google Maps / Places** | Map view, address autocomplete and geocoding | Map blank, address autocomplete degrades to free text |
| **Resend** (primary) / **Brevo** (legacy) | Transactional email notifications | Emails silently fail; failures land in `email_logs` |
| **External ERP + CSV feeds** | Partner and stove ID synchronisation | Inventory drifts; `sync_logs` records the failure |

Notable libraries: React 19, TanStack Router/Start/Query, Vite 8, Tailwind CSS v4, Radix UI + shadcn components, Recharts (charts), react-hook-form + zod, date-fns, jsPDF + jspdf-autotable and html2canvas (agreement/receipt PDFs), pdfjs-dist (PDF preview), deck.gl + @react-google-maps/api (map layers), sonner (toasts), react-markdown + remark-gfm (this document).

---

## 10. Deployment

### Frontend (Vercel)

- Framework: Vite; build `bun run build`; install `bun install`.
- Environment variables from section 5 must be set for **Production**, **Preview** and **Development**.
- Deploys are triggered by pushes to `main`.

Known build pitfalls, all already mitigated in the repo:

| Pitfall | Mitigation |
| --- | --- |
| `failed to parse lockfile: bun.lock` | Keep a clean, regenerated `bun.lock`; never hand-edit it |
| `No version matching "@lovable.dev/vite-tanstack-config" ... blocked by minimum-release-age` | Pin the dependency to a version older than 24h |
| `Error: supabaseUrl is required` during SSR | Supabase clients are lazily created behind a Proxy in `src/lib/supabaseClient.ts`; never construct a client at module scope |
| `/assets/*.js` 404 after a redeploy | `src/lib/chunk-reload.ts` detects stale chunk/dynamic-import failures and performs one guarded reload |

### Backend (Supabase)

- Edge Functions: `supabase functions deploy <name>` (or all). They go live immediately; there is no separate promotion step.
- Secrets: `supabase secrets set KEY=value` — changing a secret requires no redeploy of the frontend.
- Schema changes: SQL is applied through the Supabase SQL editor or the CLI; keep a copy of every applied script in `supabase/sql/` and refresh `supabase/SUPABASE_TABLE_OVERVIEW.md` afterwards.

### Rollback

- Frontend: promote the previous Vercel deployment.
- Edge Function: redeploy the previous version from git.
- Data: destructive SQL should always be run inside a transaction with a verified `SELECT` first; there is no automatic table-level undo beyond Supabase's point-in-time recovery.

---

## 11. Operations and Troubleshooting

| Symptom | Likely cause | Where to look |
| --- | --- | --- |
| "A customer with this phone number already exists" | Deliberate uniqueness rule on end-user phone | `CreateSalesForm.jsx` + `create-sale`; the message includes the conflicting transaction ID |
| Phone rejected as invalid | Only `08031234567`, `+2348031234567`, `2348031234567` are accepted | `isValidNgPhone` in `src/app/utils/` |
| A stove serial does not appear in the sales form | Stove ID not `available`, not assigned to that partner, or a PostgREST filter escaping issue with special characters in the partner name | `manage-organizations`, `get-stove-ids` |
| LGA blank when editing a sale | State/LGA options not yet loaded when the Select renders | `normalizeSaleLocation` in `salesFormUtils.js`; the Select is keyed to remount |
| Cannot delete an ACSL agent | Dependent rows (agent-organisation links, `manager_id`, credentials, audit references) | `supabase/functions/_shared/deleteUserCleanup.ts` |
| `END_USER_RECORDS_API_KEY not configured` | Edge Function secret unset | `supabase secrets set END_USER_RECORDS_API_KEY=...` |
| Name change does not reflect after editing a user | `auth.users` metadata must be updated before `profiles` | `manage-users/write-operations.ts` |
| Random 404s on JS assets | Tab running a previous deploy | Automatic single reload via `chunk-reload.ts` |

### Routine maintenance

- Review `sync_logs` after each ERP sync for failed partners or skipped stove IDs.
- Review `email_logs` for delivery failures.
- Rotate `END_USER_RECORDS_API_KEY` and Google keys periodically; Google keys should be referrer-restricted.
- Re-export `supabase/SUPABASE_TABLE_OVERVIEW.md` whenever the schema changes so this document stays accurate.

---

## 12. Glossary

| Term | Meaning |
| --- | --- |
| **ACSL** | Atmosfair Clean Stoves Ltd — the operator of the platform |
| **Partner** | A distributor organisation selling stoves; stored in `organizations` |
| **Partner agent** | A staff member of a partner who records sales for that partner |
| **ACSL agent** | ACSL field staff assigned to partners and states |
| **Agent manager** | Supervises a group of ACSL agents (`profiles.manager_id`) |
| **Stove ID / serial** | Unique identifier of a physical stove (`stove_ids_base.stove_id`) |
| **Sales model / payment model** | Pricing plan: outright or installment with duration and minimum down payment |
| **Installment** | A partial payment recorded against a sale |
| **End user** | The household or individual that receives and cooks with the stove |
| **On-behalf sale** | A sale recorded by an ACSL agent for a partner (`sales.sold_on_behalf_of`) |
| **Sell-through** | Stoves sold ÷ stoves received, per partner, agent or state |
| **Records collected** | End-user records successfully captured for sold stoves |
| **LGA** | Local Government Area — the administrative unit below a Nigerian state |
| **Transfer / purchase from ACSL** | A batch of stove IDs moved from ACSL to a partner |
| **Reconciliation** | Comparing platform data with ERP/CSV sources and correcting drift |
| **RLS** | Row Level Security — Postgres policies restricting row visibility |
| **Service role** | Supabase key that bypasses RLS; used only inside Edge Functions |
