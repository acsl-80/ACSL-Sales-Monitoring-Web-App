# App Documentation — handover guide in-app

Add a sidebar link **App Documentation** that opens a new **System Documentation** view containing a complete, self-contained handover document for a developer who has never seen this codebase.

## 1. Sidebar link

- Add to `src/app/components/Sidebar.jsx`, immediately after **API Documentation**:
  - name: `App Documentation`, icon `BookOpen`, route `app-docs`, href `/system-documentation`
  - Gated to super admins only (same explicit `isSuperAdmin` check used by API Documentation).
- Map the route in `DashboardLayout.tsx` active-route logic so `/system-documentation` highlights **App Documentation** (not another item).

## 2. New view

- Route: `src/routes/system-documentation/index.tsx` → lazy-loads `src/app/system-documentation/page.tsx`, wrapped in `ProtectedRoute` (super admin).
- Content component `SystemDocumentationContent.tsx`, styled to match existing views (green `#4a5d0f` header, white cards, no shadows/alternating rows):
  - Page header: title, "handover documentation" subtitle, last-updated date.
  - Sticky **Table of Contents** sidebar (anchor links to each section) + scrollable document body.
  - Utility buttons: **Print / Save as PDF** (browser print of the doc area) and **Download Markdown** (serves the raw `.md` file).
- The document text lives in one Markdown file (`src/app/system-documentation/APP_DOCUMENTATION.md`), rendered with the existing Markdown rendering approach already used by the docs pages, so the same file is both the on-screen doc and the downloadable artifact.

## 3. Document sections (all required, written from actual code)

1. **System Overview** — what the platform does (clean-cookstove sales, partners/agents, installment payment models, stove ID tracking, end-user records), primary user journeys.
2. **Architecture** — React 19 + TanStack Start (Vite) frontend, Supabase (Postgres + Auth + Storage) backend, ~50 Edge Functions as the service layer, external ERP/CSV sync, Brevo/Resend email, Google Maps/Places. ASCII diagrams for request flow and the sale-creation flow.
3. **Repository Structure** — annotated tree of `src/app` (feature folders), `src/routes` (file-based routing + `routeTree.gen.ts` caveat), `src/compat` (Next.js shims: `Link`, `Image`, `navigation`), `src/lib`, `src/services`, `supabase/functions`, `supabase/sql`.
4. **Local Development Setup** — prerequisites, `bun install`, `.env.local` from `.env.example`, `bun run dev` on port 8080, Supabase CLI usage, edge-function deploy/serve commands, common startup failures.
5. **Configuration & Environment Variables** — table of every `VITE_*` client var and every Edge Function secret in use (Supabase URL/keys, `END_USER_RECORDS_API_KEY`, Google keys, email keys), where each is read, and which are safe to expose.
6. **Data Model** — table-by-table reference generated from `supabase/SUPABASE_TABLE_OVERVIEW.md`: columns, keys, RLS policies, plus an entity-relationship diagram covering `profiles`, `organizations`, `sales`, `stove_ids`, `installment_payments`, `payment_models`, `organization_payment_models`, `acsl_agent_organizations`, `acsl_agent_states`, `credentials`, `addresses`, `email_*`, `app_settings`, `app_releases`, sync/audit tables. Key lifecycles documented: stove ID status transitions, sale status transitions, cancellation/archive flow.
7. **API Reference** — every Edge Function grouped by domain (sales, stove IDs, users/profiles, organizations, payment models, dashboards, sync/reconciliation, settings/tokens, geo, email), with method, purpose, auth requirement, request/response shape for the important ones; full documentation of the public **End User Records API** (bearer key, filters, pagination, sample payloads).
8. **Authentication & Authorisation** — Supabase Auth + the custom `login-with-credentials` username-or-email flow, session/profile caching (`authCache.ts`, `profileService`), the five roles (`super_admin`, `acsl_agent_manager`, `acsl_agent`, `partner`, `partner_agent`), the `permissions.ts` / `usePermissions` feature-key model, `ProtectedRoute` and `RoleGate`, RLS patterns and why the service role is confined to Edge Functions.
9. **Third-Party Services & Dependencies** — Supabase, Vercel, Google Maps/Places, Resend/Brevo, pdfjs-dist/jsPDF, Recharts, Radix/shadcn, Tailwind v4; what breaks if each credential lapses.
10. **Deployment** — Vercel build config and known pitfalls (lockfile, `@lovable.dev/vite-tanstack-config` pin, SSR-safe lazy Supabase client, stale-chunk auto-reload), edge-function deployment, secrets management, migration/SQL script process, rollback.
11. **Operations & Troubleshooting** — runbook of the recurring issues (duplicate phone validation, LGA recall, stale asset 404s, user deletion cleanup, missing API key errors), where to look first.
12. **Glossary** — ACSL, partner, partner agent, stove ID, sales model, sell-through, LGA, end user, on-behalf sale, records collected, etc.

## Technical notes

- Documentation content is static Markdown — no new database tables, Edge Functions, or migrations.
- Data-model section is derived from the committed `supabase/SUPABASE_TABLE_OVERVIEW.md`; if a table there is stale the doc will note the refresh command rather than guess.
- No existing behaviour changes beyond the sidebar entry and active-route mapping.
