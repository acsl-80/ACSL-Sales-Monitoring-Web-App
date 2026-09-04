# Dashboards: where every number comes from

## The one rule

**A dashboard never aggregates.** Every total, count and breakdown is computed
ahead of time into `metric_snapshots`, and reading one is an indexed lookup.

Stated as something anyone can check by reading: if a query behind a dashboard
contains `count(*)`, `sum()` or `group by` over `public.sales`, it is in the
wrong place.

That is checkable, and it holds today:

```bash
grep -E "count\(\*\)|sum\(|group by" supabase/functions/data-center-read/index.ts
```

returns one line, and it is the comment stating the rule.

## The split, measured

| | Where | At 500,000 sales |
|---|---|---|
| **Compute** | `data-center-compute` → `data_center.compute_metrics()` | 74 metrics in **5.2 s** |
| **Read** | `data-center-read` action `dashboard` → `v_current_metrics` | **2.3 ms** of SQL |

The read is 2.3 ms because it never touches `sales`, and it would be 2.3 ms at
five million sales for the same reason.

### The honest end-to-end number

SQL time is not user time. Through the edge function, the same dashboard load
is about **250 ms locally** against 500,000 sales, and about **1.8 s on the
preview branch** against five.

A branch holding five sales being slower than a local database holding half a
million is worth sitting with, because it says exactly where the time goes: the
connection and the round trip, not the data. Since Phase 4 stopped pooling
connections between requests (pooling was exhausting the database and taking
PostgREST down with it), each request pays a fresh connection.

That is why this read is **one statement rather than three**. Collapsing it took
the branch number from about 3 s to about 1.8 s without changing a single value
it returns.

Supabase's pgbouncer pooler was tried and made it worse, 2 s to 3.2 s, because
its host is in a different region from the project. `DATA_CENTER_DB_URL` is
left as a hook so it can be adopted on a project where it does help, but it is
a thing to measure rather than a thing to assume.

## The completeness number, and why it is not the sales app's

`calculate_sale_status()` requires a stove photo and an agreement document
before it returns `completed`. The Sell Stove form stopped requiring either.

In production that means **all 17 live sales read `incomplete`**, every one of
them missing both the stove photo and the agreement and nothing else. Not one
live sale reads `completed`; the eight rows that do are all cancelled.
A dashboard counting completed sales would report 1 out of 15, be technically
correct, and be useless.

So the module defines completeness for itself, in two configured parts:

- `completeness_required_fields`: the columns that must be present. Six today
  (`transaction_id`, `stove_serial_no`, `end_user_name`, `phone`, `amount`,
  `address_id`); the two images are deliberately absent.
- `completeness_evidence_any_of`: the evidence the sale must carry, any one of
  which will do. Today a drawn signature (`{"kind": "column", "name":
  "signature"}`) or a receipt committed through an import that asserted the
  paper agreement (`{"kind": "import_paper_agreement"}`). The batch remembers
  that assertion in `import_batches.paper_agreement_asserted`, stamped when it
  reaches committed from `import.paper_sources` and
  `import.require_paper_agreement`. A digitised paper receipt is therefore
  complete without a signature, which is what the import accepted it as.

The dashboard no longer alarms about the sales app's own status rule. The
Complete card keeps its percentage, and a "What is missing" section names each
part of the rule with the count of live records missing it, each a link to the
records table narrowed by `missingField`. Those counts are undated on purpose:
the dashboard's period is the consignment month and the table's is the sale
date, so a dated figure could never equal the table behind it. The disagreement
with the sales app is one sentence, and it reaches zero only when the sales
app's rule changes (decision D1).

### Changing the rule

It is config, not code:

```sql
update data_center.workflow_config
set value = '["transaction_id","stove_serial_no","end_user_name","phone","amount"]'::jsonb
where key = 'completeness_required_fields';

update data_center.workflow_config
set value = '[{"kind": "column", "name": "signature"}]'::jsonb
where key = 'completeness_evidence_any_of';
```

The next run uses it, and the Missing facet offers the new parts without a
release. Column names are validated against `information_schema.columns` before
they reach a query, so a value written here cannot become SQL; a name that is
not a column of `public.sales` raises rather than silently counting nothing,
and so does an evidence kind the module does not know.

## Why the computation is SQL and not TypeScript

`data_center.compute_metrics()` does all of it. The edge function creates the
run, calls that, records what happened.

Three reasons, and the third is a measurement:

- One round trip rather than twenty, which matters against an edge function's
  wall clock.
- One reviewable place. "Where does that number come from" has a single answer.
- The completeness predicate is interpolated **once** rather than evaluated per
  row. As a per-row `to_jsonb` lookup the same count took **73 seconds**; as
  plain column predicates it takes **549 ms**. Same answer, 133 times faster.

## Runs, and saying when the numbers are from

Each computation is a row in `metric_runs`, every snapshot belongs to one, and
`v_current_metrics` reads **the newest run whose status is `ok`**.

That matters in three ways:

- A failed run shows the previous numbers rather than none, and never a
  half-written set.
- The dashboard can say when it was computed, and marks itself stale past
  `metrics.stale_after_hours` (24 by default). Numbers with no date on them get
  read as current, and these might not be.
- `metric_snapshots` stays a history, so "how did verification look in June" is
  answerable for free.

Only one run happens at a time, enforced by `pg_try_advisory_lock` rather than
by looking for a row that says `running`. The obvious version is check-then-act:
two requests both read "none running" before either writes. That was tested, and
both got through. The advisory lock cannot be raced, and because it is a session
lock on the request's own connection it is released even if the function dies
mid-run.

## What is computed

| Family | Metrics |
|---|---|
| Volume | `sales.total`, `sales.archived`, `sales.by_month`, `sales.by_partner`, `sales.by_state` |
| Completeness | `sales.complete`, `sales.incomplete`, `sales.app_says_completed`, `sales.status_disagreement` |
| Verification | `verification.by_outcome` (including `never_called` as its own bucket) |
| Call centre | `calls.records_worked`, `calls.attempts_total`, `calls.avg_attempts`, `calls.exhausted` |
| Corrections | `corrections.open`, `corrections.fixed`, `corrections.resolved` (closes with ring again or nothing to ring), `corrections.avg_days_to_resolve` |
| Stock | `stock.by_status` |
| Import | `import.batches_committed`, `import.rows_committed`, `import.exceptions_open` |
| Scorecards | `scorecard.issued/received/digitalised/verified/unverified/unreachable/unresolved`, once per dimension |

`never_called` is deliberately its own bucket rather than folded into
`not_verified`. "Nobody has tried" and "we tried and could not confirm" are
different problems with different answers, and the queue can already tell them
apart.

Breakdowns keep the top `metrics.top_n` (15) entries. A dashboard with 500 bars
is not a dashboard.

## The scorecards

Five tables showing the same seven columns, each cut by a different dimension:
partner, location, sales rep, call agent, manager. One engine
(`compute_scorecards`) and one component (`Scorecard.jsx`); a dimension is a
row in a VALUES list and a prop, never an implementation.

The dimension travels inside the snapshot as data: `{by, key, label}`. `by`
names the cut, `key` is what a drill-through filters on, `label` is what a
human reads. The reader never joins to find out what a row means.

Two sources, one meaning per column. Partner, location and sales rep sum
`transfer_funnel`: what was shipped, and what came back. Call agent and
manager count assigned records: what was handed out, and what each became.
For people, `issued` means handed to them, `received` means touched at least
once, and `digitalised` means concluded. Reclaimed batches are not counted,
so nobody is charged for work taken back.

On every row, verified + unverified + unreachable + unresolved equals the
reconciling column (digitalised for shipments, issued for people), because
unresolved is defined as the remainder. The scorecard spec asserts this per
row on every run.

**Every status cell is a door.** It links to the call centre queue with the
dimension and status as URL search params, which the queue translates into
server filters. Back restores the dashboard because nothing was component
state. The filters behind the doors: `outcomeGroup`, `partnerState`,
`transferSalesRep`, `assignedAgent`, `agentManager`, beside the existing
`organizationId`.

## Adding a metric

Add it to `compute_metrics()` in the migration, in the family it belongs to, and
read it in `Dashboard.jsx` by key. There is no registry here, unlike the call
centre questionnaire, and that is deliberate: a metric is not just a value, it
is a decision about what to count, and it should be reviewable as a diff.

## What is not built

- **No schedule.** Computing is on demand, super admin only. A cron would need
  to answer "whose numbers are these and who asked" and Phase 6 has no good
  answer yet. `metric_runs` already records who triggered each one, so adding a
  schedule later is small.
- **No drill-down from a chart.** A bar is a number, not a filter. The
  scorecards drill; the bar charts still do not.
- **No date-range selector.** Everything is "as of the last run". Historic
  comparison is possible from `metric_snapshots`, which keeps every run, but
  nothing reads it that way yet.
