# Data Center decisions

The why behind the choices that are not obvious from the code. Numbering
continues from the table in PLAN.md (D1 to D16 there).

## D17. Align the sales app's status rule (2026-09-04, awaiting the owner's word)

Three implementations of `sales.status` exist: two SQL functions named
`calculate_sale_status` (the record-typed one wins, applied last by
`trigger_update_sale_status`) and `resolveSaleStatus` in `_shared/saleStatus.ts`.
The SQL ones require a stove image and an agreement image the Sell Stove form
made optional, so all 2,205 live sales read `incomplete`. The recommendation is
one SQL function mirroring the TypeScript rule, one trigger, a recompute. The
Flutter app prints the word raw, so the owner decides.

## D18. Complete for a digitised paper receipt (2026-09-04)

`completeness_required_fields` names `signature`. Paper receipts are imported
with `import.require_paper_agreement` and carry no drawn signature, so the
module's own rule called 2,151 of them incomplete. Evidence becomes
configurable: a drawn signature or a commit through a receipt batch that
asserted the paper agreement.

## D19. Where the transfer's sales model lives (2026-09-04, awaiting the owner's word)

`stove_transfer_history` has no model column. `external-csv-sync` reads the
ERP's Order Sales Model, mirrors it onto `organization_payment_models`, and
drops it. The fact should live on the transfer row, written by the sync, as
three additive nullable columns. This is the one `ALTER TABLE` in `public` in
the programme; it is the host's table and the host's sync, so it is a host-lane
change.

## D20. Reps with no account (2026-09-04)

The send-back stays routed to the standing recipients and any data manager,
who fix it on the rep's behalf; the episode records `fixed_on_behalf`. A
`delegate_user_id` on `sales_rep_accounts` lets an administrator name a
delegate. Creating accounts is outside the module.

## D21. Recall is derived, and the saved phone is the truth after a fix (2026-09-04)

A record whose fix the call centre closed with "ring again" needs calls
again, and it had usually used up its three. No flag is set: the episode
snapshots `attempts_at_close`, and `v_callable_records` tests
`attempt_count - attempts_at_close` against the same `callback_limit`. The
engine reads the view and needs no change, and a second close gives a
second allowance without anything to reset.

The call centre's `corrected_phone` was a note of what the buyer said before
Sales saved anything. Once Sales has saved the same number (same last ten
digits, however typed) the note is cleared on close, so the queue dials one
number. When the two differ nothing happens on its own: the review panel
shows both and the reviewer chooses. The record is never edited by the
module; `public.sales.phone` stays where the sales app put it.

## D22. The engine picks from module access, and capacity is a refusal with a door in it (2026-09-04)

`assign_batches` chose its agents from `call_agent_profiles` with an inner
join to `module_access`. No profile row had ever been written in production,
so the engine found nobody, and every one of the open batches was handed out
by hand, five agents ending three over a capacity of one. The agents read and
the staleness sweep already treated a missing row as "enabled, default
capacity"; the engine now reads the same rule, so three readers agree.

The manual door refuses a paused agent outright and refuses more than the
agent's capacity unless the supervisor gives a reason. The reason lands on
the batch (`override_reason`) so the log says why, rather than a hard wall
that would be worked around by pausing the rule. Nothing is backfilled: the
five agents over capacity show as "3 of 1" on the console until somebody
reclaims or reassigns.

## D23. What the pool leaves out, and no index on public.sales for the picker (2026-09-04)

`v_callable_records` now leaves out a record with Sales (an open or fixed
episode), a record with a call draft saved within `assignment.draft_holds_hours`,
and a record rung within `callback.recall_after_days` unless a ring-again close
is newer than the attempt. Each is configuration. An unconfirmed shared phone
stays in: the call is how a suspicion becomes a fact. On production the day it
shipped these three exclusions removed nothing (0 with an open episode in the
pool, 0 recent drafts, 0 rung in the last two days), so the callable count
stays 1,475 until the call centre's own activity starts holding records back.

The plan reserved an index on `public.sales (created_at)` for the picker's
"newest digitised" order. Not added: the picker sorts one partner's callable
set, hundreds of rows now and a few thousand at the 500,000 target, after the
partner filter that `idx_sales_org_date_id` already serves. The module's one
index on `public` stays the one. If a plan ever shows the sort as the cost, the
earlier index migration's pattern applies: a plain index in the migration for
fresh databases, a CONCURRENTLY script run by hand on production.

## D24. Presence is derived, and the board's numbers come from the one engine (2026-09-04)

The control centre says who is Working, Available, At capacity, Away or
Paused without a channel or a heartbeat. The editor's autosave, a batch's
last activity and a logged attempt already leave timestamps; the newest of
them is `last_seen_at` in `v_agent_activity`, and the agents read grades it
against `presence.working_within_minutes` and `presence.away_after_minutes`.
"On record" is the last draft's stove, said as a last save, because drafts
are deleted on save and a live cursor would be an invention.

The board's counts over sales (callable, recently digitised, never called,
by partner) are a family in `compute_metrics`, not a second engine on the
page. The function takes an optional list of families; `array['pool']` is
what the board's Recompute presses, writes that family alone and returns,
and whoever may hand out work may press it. The full run stays a super
admin's and is unchanged. Live numbers (open batches, who is on which
partner, the work waiting on people) come from the small tables through
reads that already existed. The page refreshes all of it together at
`call_centre.refresh_seconds` while the tab is visible.

## Observations recorded, not acted on

- 181 live sales carry a payment model outside their partner's entitlement.
- The host form keeps its own hard-coded previous-stove list.
- The sales app's own audit (`create_sales_history()`) tracks nine columns,
  none of them the phone, and writes nothing when no session user is set,
  which is the case for every edit `update-sale` makes under its service
  client. So the host's history does not see the module's fixes. The
  episode's `before` and `after` snapshots are the audit of a correction;
  the review panel shows the host's rows as a supplement and says so.
