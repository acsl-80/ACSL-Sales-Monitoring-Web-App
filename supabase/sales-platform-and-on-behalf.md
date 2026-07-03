# Sales: platform tracking + "sold on behalf of" attribution

**Audience:** whoever maintains `sales-monitoring-web` (web app + Supabase edge functions).
**Companion SQL:** `20260628_sales_platform_and_on_behalf.sql` (run first).
**Date:** 2026-06-28

## 1. Platform tracking

New column `sales.platform text NOT NULL DEFAULT 'web'` (CHECK in `web | mobile`).
`create-sale` must read `platform` from the request body and insert it. The mobile app
sends `"platform": "mobile"`; the web app should send `"platform": "web"` (or rely on the
default). Used for channel performance reporting (web vs mobile).

```ts
const platform = body.platform === "mobile" ? "mobile" : "web";
// ...in the sales insert:
platform,
```

## 2. Sold-on-behalf-of attribution

New column `sales.sold_on_behalf_of uuid REFERENCES profiles(id)`. `created_by` remains the
**actual creator** (audit); `sold_on_behalf_of` is the agent the sale is **attributed to**.

### Payload
`create-sale` reads an optional `soldOnBehalfOf` (a `profiles.id`). When omitted, it defaults
to the creator (self-sale):

```ts
const soldOnBehalfOf = body.soldOnBehalfOf || userId;
```

### Validation rules (enforce server-side)
Resolve `organizationId` as today, then validate `soldOnBehalfOf` against the creator's role:

- **self-sale** (`soldOnBehalfOf === userId`): always allowed.
- **super_admin:** `soldOnBehalfOf` may be any agent tied to the selected org — i.e. a
  profile whose `organization_id = organizationId` **or** that has a row in
  `acsl_agent_organizations(agent_id = soldOnBehalfOf, organization_id = organizationId)`,
  and whose `role IN ('acsl_agent','acsl_agent_manager','partner_agent')`.
- **acsl_agent_manager:** `soldOnBehalfOf` must be **an agent under them AND tied to the org** —
  `profiles.manager_id = userId` AND tied to `organizationId` (as above). Or self.
- **acsl_agent / partner_agent:** only self (ignore any other value).

Reject with 403 if the attribution is not permitted. Then insert:

```ts
sold_on_behalf_of: soldOnBehalfOf,
```

### Selection model (how the mobile/web UI gathers these)
The seller picks, in order:
1. **Partner (organization)** — required for super_admin & acsl agents (sets `organizationId`).
2. **On-behalf agent** — optional; the agent the sale is for. Super admin sees acsl_agents
   **and** acsl_agent_managers tied to that org; an acsl_agent_manager sees acsl_agents under
   them tied to that org (or "myself"). Defaults to self when not chosen.
3. **Stove ID** — tied to the selected org (unchanged).

### Endpoint to list candidate agents for an org — NEW: `get-organization-agents`
A new edge function `supabase/functions/get-organization-agents/` is provided (deploy it).
`GET /get-organization-agents?organization_id=<uuid>` returns the sellable agents tied to the
org (`{ id, full_name, email, phone, role, status, manager_id }`):
- **super_admin** → all `acsl_agent` / `acsl_agent_manager` / `partner_agent` tied to the org
  (org member OR `acsl_agent_organizations` assignment).
- **acsl_agent_manager** → only their own team (`profiles.manager_id = caller`) + themselves.
- anyone else → 403.

The mobile create-sale flow calls this after the partner is selected to populate the
"sold on behalf of" picker.

## 3. Reporting note
With both columns, reporting can group by `platform` (channel) and attribute revenue to
`sold_on_behalf_of` (the selling agent) rather than the creator.
