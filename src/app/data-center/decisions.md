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

## D25. Complete means the required fields plus evidence, both configuration (2026-09-04, slice 7a)

The rule required a drawn signature, so 2,286 of 2,340 live sales read
incomplete to this module although every one of them came through an import
that asserted the paper agreement. The rule now has two configured parts:
`completeness_required_fields` (six columns; the signature left the list only
because the list still read as seeded) and `completeness_evidence_any_of`,
a list of kinds any one of which satisfies it: `column` (a named column of
`public.sales`, today `signature`) and `import_paper_agreement` (the import
row that created the sale, from a batch that asserted the paper agreement
and was not rolled back; not the batch's current state, because a bench
batch reopened for one refused receipt goes back to validated). Unknown
kinds raise.

The batch remembers the assertion in `import_batches.paper_agreement_asserted`,
stamped by a trigger when a batch reaches committed, from `import.paper_sources`
(receipt, manual, field, workbench; not call_center, whose batches attach to
sales that already exist) and `import.require_paper_agreement` at that moment.
A trigger rather than the import function because that function reaches
committed on three paths. Committed batches were backfilled by the same rule.

The dashboard's amber notice about the sales app's status rule is gone. In its
place the Complete card keeps its percentage and a "What is missing" strip
names each part of the rule with the count of live sales missing it (undated,
over every live sale, so the table it links to agrees by construction), linking
to the records table narrowed by the new `missingField` filter, which the
database validates against the rule (`data_center.missing_predicate`). The
disagreement with the sales app is one sentence; D26 says what it counts once
D1 has landed.

## D26. The sales app's status rule is its form's rule, and the module's disagreement metric compares like with like (2026-09-05, slice 7b)

Three implementations of the sales app's status rule disagreed, and the one
that ran last still required two images the Sell Stove form had made optional,
so every one of 2,340 live sales read incomplete. `calculate_sale_status(sales)`
now mirrors `_shared/saleStatus.ts` line for line (twelve required fields and a
valid signature; completed, pending, incomplete), the two triggers on the
zero-argument function and that function are dropped, and the status column is
recomputed once. `update-sale` and `create-sale` keep computing the same word
in TypeScript; the trigger applies the same rule last, so the two can no longer
differ. Host lane, its own migration, applied on his word.

What it does to production, measured read-only before the change: 54 sales
read completed, 333 pending and 1,953 incomplete. The 1,953 are receipt-sheet
imports that carry no LGA, which the form requires; 63 of them also lack an
address line. The plan's estimate of 2,151 pending was made against a shorter
field list and was wrong. Whether the form's rule should require an LGA a
paper receipt never carried is a sales-team question, not this module's; the
mobile app prints the word as stored.

The module's `sales.status_disagreement` counted every module-complete sale
the app did not call completed. With the module accepting a paper agreement
as evidence and the app wanting a drawn signature, that count would read
2,286 for ever and mean nothing. It now counts sales the app calls incomplete
that the module calls complete: two rules disagreeing about whether a field is
missing, which is the only disagreement worth a number.

Two more things settled here. The recompute moves `updated_at` on every row
whose status changes, because the external records API pages incremental
syncs on `updated_at` and gates them on `completed`; without it the 54 newly
completed sales would never reach the ERP. And `assigned` is a status nothing
can reach: `assign-sale-to-agent` writes it and the trigger overwrites it in
the same statement, which was already true before this slice. The records
filter still offers the word; retiring it, or giving that function a column of
its own, is the sales app's call and is noted rather than done.

## D27. CPA is the Terms and Conditions block (2026-09-05, his answer)

The alignment document's "CPA" is the six consents the agreement carries,
already stored on every sale as `terms_accepted` and shown on the web form,
the workbench and the phone app. It is a naming and display job: the block is
labelled "CPA (Terms and Conditions)" everywhere and the external API's empty
`cpa` field carries the six consents. No new column.

## D28. Sales model and installment term come from the payment models page and the transfer (2026-09-05, his answer)

The models with their durations (Amina 12 months, Direct Community 6 and 8,
and the rest) live on `/settings/payment-models` and that table populates the
sales model dropdown on every surface; the term is shown from the model and
never typed. The ERP transfer names a model per consignment, which D19 stores
on the transfer and the workbench preselects. The document's list of terms
(4, 8, 9, 12) is superseded by the models page, which is his data to edit.

## D29. One dictionary, read by every surface; column names stay (2026-09-05, proposal accepted)

The agreement's wording is the label of every sale field on every screen,
sheet, export and API page, in the web app, the module and the phone app.
One JSON dictionary under `supabase/functions/_shared/` is the source, read at
build time by the web and served by a `sale-dictionary` endpoint for the phone
app; its labels, options and mandatory-from dates move to a public rules table
in F3 so wording changes without a release. Database column names do not
change: renaming them would break the phone app, the ERP feed and every query
for nothing a reader sees. "Mandatory" carries a date: a new record is refused
without the field after it, a record dated before it is judged by the rule of
its day, so the 2,340 historic sales are never made incomplete by a later
rule. Two host-lane rules are lifted for this programme only and additively:
columns may be added to `public.sales` (surname, first name, sales agent's
name, two note columns) and `create-sale` and `update-sale` may learn the new
payload keys. The external API keeps its current shapes and gains one with the
Stove DB names; the parent database's analysts move at their own pace. Going
forward is corrected first; history is managed, not rewritten, beyond the
mapping of 51 free-text cooking answers and the rule-based name split, both
marked as such.

Two rulings from the F1 review. The amount a form takes at creation is the
first installment, so every entry surface (the Sell Stove form, the bench, the
typed entry, the column mapper, the sheet header) calls it "Amount paid (first
installment)"; the stored running total `total_paid` is "Total paid to date"
wherever a record is read back. And the two CSV exports keep two conventions on
purpose: the Stove DB export uses the Stove DB names, the end-user records
export mirrors its own table's headings.

## D30. The bench prefills the sales agent from the transfer's rep, as a suggestion (2026-09-05, slice F2)

The sheet migration says the transfer's rep is not the agent, and the F2
backfill left imported sales' agent empty for that reason. The bench still
prefills the agent's name from the rep, because on most receipts they are the
same person and an empty field that a typist never fills is worth less than a
suggestion they can change; the help text says where the name came from. The
typed-record form makes no such guess, since it has no transfer in view. The
sheet column asks for the name as written, and the call centre confirms it.
A name entered over the default drops the account id, so a name and an id
never point at two different people.

## D31. A rule refuses at the form and marks at the server; "now" means go-live (2026-09-06, slice F3a)

"Mandatory" lives in one public table, `sale_field_rules`, one row per field
with the day it becomes mandatory and which rules read it. A sale is judged by
the rows dated on or before its own sales date, so a record made before a rule
is never made incomplete by it. Three dates carry the rows: 2000-01-01 for the
form's own rule since the form existed (slice 7b's list minus the contact
pair, which A4 made optional; the sales app reads these, the module keeps its
six-field baseline of D25), the go-live of the field alignment for the
proposal's "now" fields (surname, first name, city, sales agent, baseline
stove, the consents), and 2027-01-05 for A5's four-months-out fields (pots,
Wonderbox, fuel source). The dictionary's placeholder of 2026-01-01 was wrong
for "now": every live sale is dated after it, so it would have judged all of
history by the new rule.

The web forms refuse a new record without a field the rules require for its
day; `create-sale` accepts it and the status reads incomplete, as it does
today for an LGA. Refusing at the server would have stopped the phone app's
sales the day the rule landed, before brain-codes ship the fields. The status
column is the enforcement, visible on every dashboard, and the phone app reads
the same table through the dictionary endpoint when it catches up. The
TypeScript mirror of the status rule is gone: the trigger owns the verdict and
the two functions read it back.

## D32. One door onto the sale's option lists; what a client sends is placed, never refused (2026-09-06, slice F3b)

The sale record's three choices (baseline stove, fuel source, cooking
location) are option lists in the Data Center registry, the same registry
the call form reads, so one list serves the sale and the call (A7). The
schema stays out of PostgREST; the host reads the three lists through one
security-definer function, `public.sale_options()`, which returns those lists
and nothing else. The dictionary endpoint serves the options live to the web
forms and the phone app; the JSON in the repo is the seed and the fallback.

What a client sends for a choice is placed on the list: a value, a label, an
older value, or the free text the phone app still sends, by the rules the
proposal named (market, buying and kasuwa to purchase; farm to collect;
kitchen to indoor; outdoors to outdoor; wood_stove to firewood). A word the
rules cannot place keeps its text in the note column and leaves the choice
empty for the call centre. History was mapped the same way, with every
original kept in the note columns, so the mapping reverses from them. The
import is the one channel that refuses an unplaceable word, naming the
choices, because a rejected row is corrected where a silently emptied cell
is not.

The payment type is its own control on both forms, apart from the sales
model (A9): cash or installment first, the model for an installment; picking
a model on the bench sets the type. The payload does not change.
