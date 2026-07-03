# Access Control

## Core principle: one system, dynamic permissions

This app is **one application** with **one UI, one navigation system, one component system, one feature architecture**. There are no per-role interfaces, duplicate screens, duplicate workflows, or duplicate business logic.

- The **Super Admin view is the baseline**. Every route, page, and menu item the Super Admin can see is the complete set of surface area in the system — nothing else should exist. Anything not visible to Super Admin should not exist elsewhere (no hidden/extra routes for other roles).
- All roles share the same sidebar, routes, and components. Differences between roles are expressed purely as **permissions**, which control:
  - Whether a nav item / route is visible (`canRoute`)
  - Whether a section, button, or action renders
  - Which records are visible within a shared view (row/organization-level scoping)
- New roles must be added by extending permission rules, never by creating new views, pages, or duplicate logic.
- All authenticated users land on `/dashboard` (single entry point, single redirect rule) — the dashboard content itself is scoped by permission, not routed to a different page per role.

## Roles

- `super_admin`
- `acsl_agent_manager`
- `acsl_agent`
- `partner`
- `partner_agent` (a.k.a. `agent`)

## RBAC Matrix

| Module / Menu | Super Admin | ACSL Agent Manager | ACSL Agent | Partner | Partner Agent |
|---|---|---|---|---|---|
| Dashboard | Global dashboard | Assigned partners + ACSL agents | Assigned partners' stove inventory + own sales (see note below) | Own organization | Org's stove inventory + own sales (see note below) |
| User Management → User Manager | All users | ACSL agents + assigned partner users | No Access | Own Partner Agents | No Access |
| User Management → User Groups | Full access | No Access | No Access | No Access | No Access |
| Partner Management | All partners | Assigned partners | Assigned partners | No Access | No Access |
| Agent Management → ACSL Agents | All | ACSL agents under manager | No Access | No Access | No Access |
| Agent Management → Partner Agents | All | Assigned partner agents | Assigned partner agents | Own partner agents | No Access |
| Performance Report → ACSL Agents Tab | Full access | Assigned ACSL agents | No Access | Hidden | No Access |
| Performance Report → Partners Tab | Full access | Assigned partners | Assigned partners | Own organization only | No Access |
| Manage Sales | All sales | Assigned partner sales | Assigned partner sales | Organization sales | Own sales only |
| Stove Users Data | All records | Assigned partner records | Assigned partner records | Organization records | Own sales records |
| Track Stoves | All stoves | Assigned partner stoves | Assigned partner stoves | Organization stoves | Assigned stoves |
| Map | Full access | No Access | No Access | No Access | No Access |
| Settings | Full access | No Access | No Access | No Access | No Access |

Legend: **Full access** = complete module access • **No Access / Hidden** = menu item not visible or restricted for this role.

## Confirmed access rules (source of truth)

- All users log in and land on the same `/dashboard` route (single redirect for all roles).
- All users share the same sidebar and view scaffolding as Super Admin; visibility is filtered via `canRoute` permission checks, not separate layouts.
- Users at every level only see information/records relevant to them (org/assignment-based row scoping).
- **Partners and Partner Agents**: no access to Partner Management or Agent Management.
- **Partners**: no access to the ACSL Agents Performance Report tab.
- **Partners**: in User Management, can create **only** Partner Agent users; the role dropdown is locked to "Partner Agent" and the partner's own organization is preselected in the form (no picker choice).
- **Only Super Admin** has access to: User Groups, Map, Settings.
- **ACSL Agent Managers**: can access records for ACSL agents and partners assigned to them (their own scope), plus records for partners assigned to those partners.
- **Partner Agent and (plain) ACSL Agent dashboard scope is split by data type, not a single blanket rule** — both are "created under" a scope-owner (a partner org, or a set of assigned partners) and inherit that owner's stove ledger, but their own sales stay personal:
  - **Stove inventory** (`stovesReceived`, `availableStoves`): scoped to the **whole owning scope** — for a Partner Agent, their partner organization's stove IDs; for an ACSL Agent, the combined stove IDs across every partner assigned to them (`resolveAssignedOrgIds`). Neither role personally "receives" stoves — the org/partners do, and everyone under that scope shares visibility into it.
  - **Sales-derived numbers** (`stovesSold`, financial summary — expected receivable / amount received / outstanding balance, sales-by-model, sales-by-state): scoped to **sales attributed to that specific individual only** (`sold_on_behalf_of = them`), not every sale within their scope. A Partner Agent does not see another agent's sales under the same partner; an ACSL Agent does not see sales made by other agents/agents' teams across their assigned partners.
  - **ACSL Agent Manager is the exception** — a manager is tracking their whole team's performance, so their sales figures stay aggregated across every org assigned to them (directly or inherited from their subordinate ACSL agents), not filtered down to their own personal sales.
  - **Manager scope is org assignment OR team attribution, not org assignment alone.** A subordinate ACSL agent can be individually assigned a partner org that isn't (yet, or ever) formally assigned to the manager — the manager must still see that agent's sales. So a manager's sales queries match `organization_id IN (assignedOrgIds)` **OR** `sold_on_behalf_of IN (self, subordinate agent IDs)`. Org-only scoping silently hides a subordinate's sales whenever the org assignment lives only on the agent, not the manager — this happened for real (a manager couldn't see their agent's monthly sales) and is fixed in both `supabase/functions/super-admin-agent-dashboard/index.ts` (KPI numbers) and `supabase/functions/get-sales-advanced/build-query.ts` (Monthly Sales chart, Manage Sales list) — both resolve `teamAgentIds` (self + `profiles` where `manager_id = manager` and `role = 'acsl_agent'`) and OR it into the org filter.
  - Implemented in `supabase/functions/super-admin-agent-dashboard/index.ts`: stove counts always query `stove_ids` by the owning organization scope; sales counts/financials query `sales` by `sold_on_behalf_of` for `partner_agent`/`agent`/`acsl_agent`, and by `organization_id IN (assignedOrgIds) OR sold_on_behalf_of IN (teamAgentIds)` for `acsl_agent_manager`.
  - **Every `sales` query in every scope must exclude cancelled sales (`is_archived = true`)**, and attribution filters must fall back to `created_by` when `sold_on_behalf_of` is `NULL` (older rows). Missing either of these caused a real bug: a sale cancelled by Super Admin ("incorrect record") and then re-entered correctly was double-counted in the ACSL Agent Manager's aggregated view (org-wide query had no `is_archived` filter at all), while the ACSL Agent who re-entered it saw 0 sales / no payment model (the strict `sold_on_behalf_of` equality excluded the row when that column wasn't populated). Both are now handled by a shared `personalSalesFilter` helper in that function — reuse it (or its pattern) for any new sales-derived dashboard scope instead of writing a fresh `.eq(...)` chain.

## Per-role sidebar/nav summary

- **super_admin** — everything.
- **acsl_agent_manager** — everything except Map, Settings, User Groups.
- **acsl_agent** — like manager, minus User Management and ACSL Agents Profile (Agent Management → ACSL Agents).
- **partner** — no Partner Management, no ACSL Agents Profile, no Map, no Settings, no User Groups. Performance Report shows the **Partners tab only** (own organization). Still sees User Manager, Partner Agents Profile, Sales, Stove Users Data, Track Stoves.
- **partner_agent / agent** — Dashboard, Sales, Sell Stove, Stove Manager, Stove Users Data, Sales Monitoring App only.

## User Manager (create-user) form rules

- Role dropdown options are filtered based on the caller's own role.
- **Partner caller**: role is locked to `Partner Agent`; the partner/org picker is preselected to their own organization (no other choice).
- **ACSL Manager caller**: can create `ACSL Agent` or `Partner Agent`.
- **Only Super Admin** can create `Partner` users — the Partner option is hidden from the User Group dropdown for every other caller.

## Partner Management scoping (implemented)

- `/partners/profiles` (Partner Management) and `/partners` (Track Performance) are gated by `routeKey` on `ProtectedRoute`, driven by the `PERMISSIONS` route map — `partner` and `partner_agent` are rejected even on direct URL entry (`requireAdminAccess` alone is not enough, since every role has admin-area access).
- The `manage-organizations` edge function authenticates `super_admin` plus `acsl_agent` / `acsl_agent_manager` (and legacy `super_admin_agent`). Non-super-admin roles are **read-only** (GET only) and every read is filtered server-side to `resolveAssignedOrgIds` (direct + state + subordinate-inherited assignments). Writes (create/update/delete/CSV import) remain super-admin only.
- `get-stove-stats` applies the same assignment scoping for ACSL roles; a scoped caller with zero assignments gets zeros, never global stats.
- Both Partner Management screens use one fetch path for every role — the server decides the rows; there is **no client-side filtering of a super-admin dataset** (the old `assignedOrgIds` client filter was removed, since it never worked and isn't security).
- Row actions on Partner Profiles are permission flags on the shared table: `Details` for all roles with the route, `Credentials` behind `can("credentials")`, `Edit` behind `can("edit-any-partner")` (both super-admin-only), matching the read-only "Assigned partners" access of ACSL roles.

## Agent Management scoping (implemented)

- `/agents` (Performance Report tabs), `/agents/profiles` (Agent Management → ACSL Agents), and `/agents/partner-agents-profiles` (Agent Management → Partner Agents) are gated by `routeKey` on `ProtectedRoute` (`agents`, `agents-profiles`, `partner-agents-profiles`), so roles outside the `PERMISSIONS` route map are rejected even on direct URL entry:
  - `agents-profiles` (ACSL Agents): `super_admin` + `acsl_agent_manager` only.
  - `partner-agents-profiles` (Partner Agents): `super_admin`, `acsl_agent_manager`, `acsl_agent`, `partner`. `partner_agent` has no Agent Management access at all.
- Both profile pages share one fetch path for every role — the `manage-users` edge function; the server decides the rows via `scope.ts`:
  - `super_admin` → all users; `acsl_agent_manager` → own subordinate ACSL agents (`manager_id`) + agents of assigned partners; `acsl_agent` → agents of assigned partners only (via `resolveAssignedOrgIds`); `partner` → agents of their own organization.
  - `acsl_agent` callers are **read-only** (GET only) in `manage-users` — writes are rejected in the route handler before dispatch.

## Performance Report scoping (implemented)

`/agents` renders the Performance Report as two tabs on one shared page (`src/app/agents/page.tsx`); the page is gated by `routeKey="agents"`, so `partner_agent`/`agent` are rejected even on direct URL entry.

- **ACSL Agents tab** (`SuperAdminAgentsContent`): shown only when `can("manage-acsl-agents")` (super_admin) or `can("manage-acsl-agents-scoped")` (acsl_agent_manager). Hidden for `acsl_agent` and `partner` per the matrix. The agent list comes from the `manage-users` edge function, which scopes rows server-side (`scope.ts`): super_admin → all, manager → own subordinate ACSL agents + agents of assigned partners. Per-agent performance stats (assigned/collected/in-stock) are derived only from the agents the server returned — there is no separate client-side role filter.
- **Partners tab** (`PartnersContent`): shared by every role with the `agents` route. The partner list comes from `manage-organizations` and KPI numbers from `get-stove-stats`; both scope server-side: super_admin → all orgs; `acsl_agent` / `acsl_agent_manager` → `resolveAssignedOrgIds` (read-only); `partner` (and legacy `admin`) → **own organization only** (read-only, forced to `profiles.organization_id`; zero rows if none). Writes on `manage-organizations` remain super-admin only regardless of tab.
- The old fork where a `partner` caller got a mislabeled "ACSL Agents" tab rendering a separate `PartnerAgentsContent` component was removed (the component was deleted; Agent Management → Partner Agents lives at `/agents/partner-agents-profiles` with its own scoping). Every role now renders the same tab components; only tab visibility and server-side row scoping differ.

## Manage Sales scoping (implemented)

All sales list surfaces (`/sales`, cancelled sales, financial reports, Stove Users Data / end-user records, dashboard sales tables) fetch through the **`get-sales-advanced`** edge function, and row scoping is enforced **server-side** in `supabase/functions/get-sales-advanced/build-query.ts` (`applyOrganizationFilters`):

- `super_admin` → all sales; client org filters are optional narrowing.
- `acsl_agent` / `acsl_agent_manager` → sales of **assigned partners only** (`resolveAssignedOrgIds`: direct + state + manager's subordinate-inherited assignments). Client-supplied org filters are intersected with the assigned scope — they can narrow it, never widen it. Zero assignments → zero rows, never global.
- `partner` (and legacy `admin`) → locked to `profiles.organization_id`; client org filters cannot escape it. No org on profile → zero rows.
- `partner_agent` / `agent` → **own sales only**: rows where `created_by = them` **or** `sold_on_behalf_of = them` (covers both self-created sales and sales recorded on their behalf), regardless of any client filter.

Frontend uses **one fetch path for every role** (`UnifiedSalesContent.loadSales` → `salesAdvancedService.getSalesData`). The old fork — a separate service call per role, with the agent's "own sales" scoping done by the *client* passing `createdBy` — was removed; the client no longer participates in scoping.

## Stove Users Data scoping (implemented)

`/end-user-records` ("Stove Users Data" in the sidebar) is one shared page (`EndUserRecordsContent`) for every role:

- **Route access**: all five roles have `end-user-records` in `PERMISSIONS`, and the page is gated by `routeKey="end-user-records"` on `ProtectedRoute`, so any future role without the route is rejected even on direct URL entry. Sidebar visibility comes from the same `canRoute` check.
- **Row scoping is entirely server-side** — the page fetches through the same `get-sales-advanced` edge function as Manage Sales, so the matrix row is enforced by `applyOrganizationFilters`: super_admin → all records; `acsl_agent` / `acsl_agent_manager` → assigned partners' records (`resolveAssignedOrgIds`); `partner` → own organization's records; `partner_agent` / `agent` → own sales records (`created_by` or `sold_on_behalf_of`). The client sends no role-specific filters.
- The edge function caps each response at 500 rows, so the page fetches page-by-page until `pagination.totalPages` is exhausted — otherwise large scopes (super admin, big partners) silently lose records past 500.
- The Details modal (`AdminSalesDetailModal`) is shared; its `viewFrom="superAdmin"` prop only selects the list-data field shape and hides the Record Payment button — it grants no extra capability.

## Purchases from ACSL / Stove Transfer History scoping (implemented)

`/stove-transfer-history` is gated by `routeKey="stove-transfer-history"` (super_admin, acsl_agent_manager, acsl_agent, partner — no partner_agent). The **`get-transfer-history`** edge function was previously super-admin-only (403 for everyone else); it now authenticates all four roles and scopes rows server-side on `stove_transfer_history.organization_id`:

- `super_admin` → all transfers.
- `acsl_agent` / `acsl_agent_manager` → transfers of assigned partner orgs only (`resolveAssignedOrgIds`); zero assignments → zero rows.
- `partner` (and legacy `admin`) → own organization's transfers only.

## Data scoping

Menu/route visibility is necessary but not sufficient — record-level access must also be enforced wherever a shared view is scoped by organization/assignment (e.g. org filters, RLS in services/edge functions) so that non-admin roles only see rows relevant to them, even inside a shared component.

## Implementation guardrails

- Do not add a route, page, or menu item unless Super Admin also has it. If a feature is role-specific, gate it behind a permission check on the shared component — don't fork a new page for it.
- Do not create a second sidebar, dashboard, or layout for any role. Extend the existing one.
- New roles = new permission entries in the access-control config, not new UI.
- When in doubt about whether a difference between roles should be a new screen or a permission flag: it's a permission flag.
- **No `role === X ? <ViewA/> : <ViewB/>` forks that swap out an entire section/page body.** A component may branch on role to show/hide a toolbar, button, or column, but the core structure (charts, cards, tables) must be the same JSX tree for every role, fed by role-scoped data.
  - Red flag while reviewing a diff: an `if (isSuperAdmin) { ... } else { ... }` (or ternary) that duplicates markup instead of toggling a prop/section. That's a second view in disguise and must be merged into one shared render path.
  - Precedent: the dashboard (`src/app/dashboard/components/DashboardContent.jsx`) originally had exactly this — a full rich view for `super_admin` and a stripped-down KPI-only view for every other role. Fixed by merging into a single render path where all roles get the same charts/cards, and only truly super-admin-only controls (org/state/branch filter toolbar) stay behind an `isSuperAdmin` check inside the shared component. Drilldown-capable roles (`acsl_agent`, `acsl_agent_manager`, `partner`) get clickable KPI tiles instead of navigate-away links — that's a permission-driven *behavior* difference on the same tile, not a different tile.
- When scoping data for a role (edge functions / services), the response shape returned to the frontend must stay identical across roles (same keys) — only the underlying query filter changes (org id, assignment, `created_by`, etc.). This is what lets one component render every role's data without branching on shape.
