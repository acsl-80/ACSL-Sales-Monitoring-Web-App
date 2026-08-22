# Changing the call centre table

Written for whoever has to change this six months from now. The question it
answers is the one that matters in practice: **can I do this by editing data, or
does it need a developer?**

## The rule

| You want to | How |
|---|---|
| Add a question | Insert one row into `field_defs` |
| Reword a question | Update `label` |
| Reorder questions | Update `sort_order` |
| Add a dropdown choice | Insert into `option_values` |
| Rename a choice | Update `option_values.label` |
| Retire a choice | Set `is_active = false` |
| Retire a question | Set `is_active = false`, stamp `retired_at` |
| Show a question only sometimes | Set `visible_when` |
| Limit what counts as a valid answer | Set `validation` |
| Record a fourth, fifth or tenth call | Nothing. Just log it |
| **Group a dashboard by an answer** | **Migration. See "Promotion" below** |
| **Add a new kind of input** | **Migration. The renderer has to learn it** |

Everything in the first block is data entry. Nothing in it needs a release,
a deploy, or a developer.

## Adding a question

Two inserts, or one if the choices already exist:

```sql
insert into data_center.option_lists (key, label)
values ('lpg_access', 'LPG access');

insert into data_center.option_values (list_key, value, label, sort_order) values
  ('lpg_access', 'yes',       'Yes, has LPG', 1),
  ('lpg_access', 'sometimes', 'Sometimes',    2),
  ('lpg_access', 'no',        'No LPG',       3);

insert into data_center.field_defs
  (key, label, section, input_type, option_list_key, sort_order, help_text, visible_when)
values
  ('lpg_backup_available', 'Does the household also use LPG?', 'cooking',
   'select', 'lpg_access', 20, 'Asked from August 2026.',
   '{"field":"verification_outcome","in":["fully_verified","partially_verified"]}');
```

The next page load has the question, its choices, its help text and its
condition. This was run against the 500,000-row database while building Phase 4:
the form went from 13 questions to 14, and the server began accepting the new
answer and refusing it when the condition did not hold, with no code deployed.

Sections available today are `verification`, `carbon`, `cooking` and `service`.
A new section name simply creates a new heading.

## Conditions

`visible_when` names another field and the values that reveal this one:

```json
{"field": "verification_outcome", "in": ["partially_verified", "doubtful_verification"]}
```

Null means always shown. The field named can be a `call_records` column or
another registry question.

**It is enforced twice.** The form hides the question, and the write endpoint
refuses it. That second check is the one that counts: a condition enforced only
in the browser is a suggestion, because anything can post the hidden field
anyway.

Conditions are evaluated against the record **as it will be after the save**, so
setting an outcome and answering the question it reveals works in one action
rather than needing two.

## Validation

```json
{"min": 0, "max": 9999999}      // number
{"maxLength": 240}               // text and textarea
{"pattern": "^0[789]"}           // text, a JavaScript regular expression
```

Also enforced on write, not only in the browser.

## Retiring a question

```sql
update data_center.field_defs
set is_active = false, retired_at = now()
where key = 'uses_per_day';
```

The question stops being asked. **Answers already recorded stay exactly where
they are and stay readable.** History is not rewritten because a question
stopped being asked, and a report covering last quarter still works.

The same is true of a renamed choice: records reference `option_values` by id,
so changing a label changes how it reads everywhere without altering what was
recorded.

## Promotion: when a question needs to become a column

The line is **aggregation**. A question that gets answered and read back is fine
in jsonb forever. A question a dashboard groups by is not: grouping 500,000
jsonb rows means reading all of them.

When that happens:

1. Add the column and its index in a migration.
2. Update the registry row: `storage = 'column'`, `column_name = '<the column>'`.
3. Backfill from `answers` in the same migration.

Then stop. **No client changes.** The write endpoint reads `storage` and routes
the value to the column instead of the blob, and it arrives from the browser
under the same key either way. That indirection is the entire reason `storage`
exists.

Phase 4 applied this rule to a derived value rather than a question, and the
numbers are worth keeping. `attempt_count` began as a count computed by the
view. The queue that matters most to the process, "called three times and still
not verified", took **25.8 seconds** at 500,000 rows because Postgres had to
compute the count for every candidate row before it could discard it. As a real
column maintained by a trigger, the same question takes **about 40 ms**.

That is what the rule is protecting against, stated as a number.

## What is deliberately NOT modular

Some things are fixed because making them soft would make them unreliable.

**The four verification outcomes** are a database CHECK constraint, not a
registry list. Every dashboard, every report and the whole verified/unverified
split depend on them. Changing that set should require a migration and a
conversation, not a row edit at 5pm.

**The correction loop** is columns and timestamps rather than a status field
someone can add values to. "Waiting on Sales" has to mean one thing.

**Input types.** Adding `select` or `textarea` to the list is a migration
because the renderer has to know how to draw it. Adding a *question* of an
existing type never is.

## Where each thing lives

| Concern | File |
|---|---|
| Tables and the registry | `supabase/migrations/20260820010000_data_center_call_layer.sql` |
| Rendering one question from its definition | `features/call-centre/FieldRenderer.jsx` |
| The record editor | `features/call-centre/CallRecordEditor.jsx` |
| The queue and its presets | `features/call-centre/CallQueue.jsx` |
| Validation, conditions and routing on write | `supabase/functions/data-center-write/index.ts` |
| Queue filters and paging | `supabase/functions/data-center-read/records-query.ts` |

`FieldRenderer.jsx` knows about input **types** and never about specific
questions. If you find yourself adding an `if (field.key === ...)` there, the
thing you want is probably a new input type or a `visible_when`.

---

# A call that cut off

An agent gets four answers out of eleven and the line goes dead. Until Phase 18
every one of those ended the same way: the form closed and everything typed
into it went with it, so the next agent - usually the same agent - started from
a blank sheet and asked the buyer the same four questions again.

## The form keeps itself

Two seconds after typing stops, and again when the agent closes deliberately
with **Finish later**. Autosave rather than a button, because the case this
exists for is the one where no button gets pressed: a dropped call, a closed
laptop, a crashed tab.

It only saves once the agent has actually typed something. Without that guard,
merely opening a record would leave a draft on it and put it on their
unfinished list.

Nothing in a draft is validated. A half-finished form fails validation by
definition, and refusing to keep it for rules the agent has not reached yet is
the fastest way to teach people that saving does not work. `save_call_record`
still validates and is still the only door to the record.

## Why `call_drafts` is its own table

The obvious build is `alter table call_records add column draft_values`, the way
the digitalisation workbench holds a half-typed receipt on the import row it
belongs to. It does not work here.

A workbench row already exists before anybody types into it - staging created
it. A call record does not: `call_records` gets its row on the first real save,
and `has_call_record` in the view is literally `(cr.sale_id is not null)`.

Creating that row to hold a draft would make every half-typed form read as a
record the call centre had worked:

| | Would have happened |
|---|---|
| The "never called" queue | loses the record |
| `hasCallRecord` filter | returns it |
| The scorecards | count a call nobody made |

So the draft sits beside the record. Nothing existing reads `call_drafts`, so
nothing existing changes. Proved on the preview: a draft on an untouched record
leaves `has_call_record` false and the record stays in the never-called queue.

## One draft per sale, not one per agent

Records move between agents - the console reassigns them and the engine
reclaims stale batches. A draft keyed by `(sale, agent)` would be stranded
every time that happened, which is exactly the work this exists to stop losing.

Keyed by the sale, the draft travels with the record. `saved_by` is carried so
whoever opens it next is told whose it is:

> **Musa Danladi started this and did not finish.** Their answers are in the
> form below, from 20 Aug 14:32. Nothing has been saved to the record yet.

Applied to the form rather than offered, because an agent who typed four
answers and lost the call expects to find them. What the banner is for is the
two things the fields cannot say: whose these are, and that nothing has reached
the record. One button clears them.

`base_version` carries the `call_records.version` the draft was typed against,
so a record that has moved on since is reported rather than silently
overwritten by older answers.

## On the agent's own dashboard

**My calls** ranks unfinished work second, below a stove ID somebody else took
and above a stove nobody has called. That buyer has already given their time
once and is owed the shortest possible second call, and it is the quickest
complete record on the list.

---

# Sending a record back, to somebody who will see it

The call centre could always send a record back. `correction_requested_at`
opened it, a reason said why, `correction_resolved_at` closed it. What never
existed was anybody being told, so the record moved into a state nothing was
watching and the loop closed only if somebody happened to open the right
filter.

## The rep is not a foreign key

"Send it back to the rep responsible for that consignment" sounds like a join.
`stove_transfer_history.sales_rep` is free text written by the ERP. Measured
against production:

| | |
|---|---|
| Distinct rep names | 23 |
| Matching an app profile by name | 11 |
| Not matching | 12 |

and the twelve include the three largest by volume — Femi Isaac (145
consignments), ELIZABETH TIMOTHY (68), Lucky Sunday (36). Four of the values
are not people at all: `ACSL Admin`, `Administrator`, `Keffi` (a town) and
`Gombe` (a state).

Auto-matching on name would therefore have routed most of the volume to
nobody, silently — which is worse than not offering it. So `sales_rep_accounts`
holds the link, seeded from the unambiguous matches only, and the Settings
screen is sorted by transfer count: an unlinked rep with 145 consignments and
an unlinked rep with one look identical without that number.

## Who receives it

**The recipients chosen in Settings are the authority and always receive
every send-back.** The mapped rep receives it as well, when there is one. That
order is the point: where a rep has no account the designated recipients still
treat the record, so nothing is routed into a void.

Nothing is stored per record. Routing is computed when the queue is read, from
the recipient list and the mapping as they stand now — so linking a rep this
afternoon fixes every send-back already open, not only the ones raised
afterwards.

## Linked is not the same as able to see it

Linking a rep in Settings grants them nothing, deliberately: a routing screen
that could hand out module access would be a door into the module that does not
look like one. But an administrator who links somebody and walks away believing
they are notified would be wrong, so the row says
*"linked, but this account cannot open send-backs yet"* and names the level to
give them.

That level is `sales_rep`, and it carries exactly one key. Proved on the
preview: a rep on it sees their own consignment's send-back and not another
rep's, and is refused `records`, `call_queue` and `dashboard` outright.

## What people see

A banner above every page in the module, because the person who owes an answer
did not come looking for one. It opens a list grouped by **rep, then partner,
then stove ID** — the order paperwork is filed in, not the order records were
created. Every stove ID links into the record. Closing one takes a note first,
which the call centre reads before ringing again.

## The reasons were always data

`correction_reason` is an option list like any other, edited under **Settings →
Call form → Option lists**. Adding, renaming, reordering or retiring a reason is
data entry, not a release — which is how "Name is wrong" and "Address is wrong"
were retired without a deploy, and why the settings panel points at that editor
rather than building a second one.
