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
