# Role-Based User Guide

A new **User Guide** view that teaches any new user how to use the platform, showing only the sections their role can actually access. Text-only (no screenshots), styled with the existing green theme, and reusing the layout pattern of the current App Documentation view.

## What gets added

1. **Sidebar item "User Guide"** (HelpCircle icon), visible to every signed-in role, placed near the bottom of the nav above Settings. Links to `/user-guide`.
2. **A dedicated `/user-guide` view** with:
   - Left, sticky, dynamic Table of Contents built only from the sections the current role can see.
   - Expand/collapse for chapters with sub-sections.
   - Search box that filters the TOC and jumps to matches.
   - Current-section highlighting as the user scrolls.
   - Previous / Next section buttons at the end of each chapter, plus a Back to top button.
   - Download button that exports the role-filtered guide as Markdown.
3. **Role filtering** driven by the existing permission matrix in `src/lib/permissions.ts` — each guide section declares the route key(s) it documents, and is hidden unless `canRoute` allows it. Super admin sees everything.

## Content outline (only what exists in the app today)

Written from the actual screens, forms, filters, buttons and workflows in the codebase:

1. Introduction — what the platform does, who uses it, the five user groups and what each can do.
2. Getting started — login, first-time password change, session behaviour, profile and password update, signing out, "Unauthorized" page.
3. Navigating the app — sidebar structure, expandable groups, top bar, page headers, mobile behaviour.
4. Dashboard — KPI cards, doughnut chart, financial snapshot, monthly sales chart, quick actions, global filters.
5. User Management — User Manager (create/edit user, roles, assign manager, assign partners/states, reset password, delete), User Groups (permission matrix reference), pagination and role badges.
6. Partner Management — Partner profiles table, add/edit partner, assign agents, assign payment models, partner details, purchases from ACSL.
7. Agent Management — ACSL agent profiles, partner agent profiles, Manage Agent action.
8. Performance Reports — Agents Performance, Partners Performance, States Performance: KPI cards, clickable drill-down modals, sell-through bars, search/state filters, sorting, export.
9. Manage Sales — Sell Stove form field-by-field (partner, sales model, stove serial, buyer & end user block, "same as contact person" checkbox, location cascade, images/camera, digital signature toggle, validation rules for phone numbers and duplicate end-user phone), what happens on submit and where the record appears.
10. Sales Records & Financial Reports — columns and their meaning, installment/next-due columns, Sales Tracking Bar (overdue / due today / 7 / 14 / 30 days), filter bar, payments, receipts, payment history, edit sale, cancel sale with mandatory reason.
11. Cancelled Transactions & Cancelled Purchases — what lands here, Cancelled By, stove IDs returning to available.
12. Track Stoves — stove ID statuses, allocation and transfer to partners, transfer history.
13. Stove Users Data (End User Records) — table columns, view/edit/delete actions, last modified audit, export.
14. Agreement Images — lookup by stove serial, uploaded image vs generated agreement PDF, preview and download.
15. Map — what is plotted and how to read it.
16. Settings — Payment Models, Credentials, System Configuration (including email notifications), Tools.
17. API Documentation — for super admins: the End User Records endpoint and the Try It panel.
18. End-to-end workflows — stove intake → allocation to partner → agent sale → installment collection → reporting; user onboarding; cancellation/reversal.
19. Statuses & buttons reference — every status value and action icon with its meaning.
20. Troubleshooting & common errors — duplicate end-user phone, invalid phone format, stove serial not found, organization not found, permission denied, stale-asset reload, session expiry.

Roles see a subset: e.g. partner agents get intro, getting started, navigation, dashboard, sell stove, sales records, stove tracking, end user records, workflows, statuses, troubleshooting.

## Technical notes

- Content lives in `src/app/user-guide/guideContent.ts` as an ordered array of sections `{ id, title, routeKeys, roles?, body (markdown) }`, so filtering and TOC generation share one source of truth.
- `src/app/user-guide/UserGuideContent.tsx` renders it with `react-markdown` + `remark-gfm`, reusing the component renderers already proven in `SystemDocumentationContent.tsx`; scroll tracking via `IntersectionObserver`.
- `src/app/user-guide/page.tsx` wraps in `ProtectedRoute` (no role gate — any authenticated user), inside `DashboardLayout currentRoute="user-guide"`.
- Route file `src/routes/user-guide/index.tsx` lazy-loads the page.
- Add `"user-guide"` to `RouteKey`, to `ALL_ROUTES`, and to every role's route list in `src/lib/permissions.ts`; add the sidebar entry in `Sidebar.jsx`; map the active-menu highlight in `DashboardLayout.tsx`.
- Existing App Documentation view is left untouched.
