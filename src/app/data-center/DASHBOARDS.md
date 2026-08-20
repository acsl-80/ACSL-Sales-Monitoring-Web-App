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
| **Read** | `data-center-read` action `dashboard` → `v_current_metrics` | **2.3 ms** |

The read is 2.3 ms because it never touches `sales`. It would be 2.3 ms at five
million sales for the same reason.

## The completeness number, and why it is not the sales app's

`calculate_sale_status()` requires a stove photo and an agreement document
before it returns `completed`. The Sell Stove form stopped requiring either.

In production that means **30 of 38 sales read `incomplete`**, including 14 of
the 15 live ones, and exactly one sale in the whole database reads `completed`.
A dashboard counting completed sales would report 1 out of 15, be technically
correct, and be useless.

So the module defines completeness for itself, from
`workflow_config.completeness_required_fields`, which today names seven fields
and deliberately omits the two images.

Against the 500,000-row seeded database the two rules disagree like this:

| | Count |
|---|---|
| Live sales | 480,005 |
| Complete, by this module's rule | 480,000 |
| Complete, by the sales app | 120,000 |
| **Disagreement** | **360,000** |

The dashboard shows that gap rather than hiding it, because it is a real defect
in the sales app and a number is harder to forget than a note. Fixing
`calculate_sale_status()` is the sales app's work, not this module's.

### Changing the rule

It is config, not code:

```sql
update data_center.workflow_config
set value = '["transaction_id","stove_serial_no","end_user_name","phone","amount","address_id"]'::jsonb
where key = 'completeness_required_fields';
```

The next run uses it. Field names are validated against
`information_schema.columns` before they reach a query, so a value written here
cannot become SQL, and a name that is not a column of `public.sales` raises
rather than silently counting nothing.

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
| Corrections | `corrections.open`, `corrections.resolved`, `corrections.avg_days_to_resolve` |
| Stock | `stock.by_status` |
| Import | `import.batches_committed`, `import.rows_committed`, `import.exceptions_open` |

`never_called` is deliberately its own bucket rather than folded into
`not_verified`. "Nobody has tried" and "we tried and could not confirm" are
different problems with different answers, and the queue can already tell them
apart.

Breakdowns keep the top `metrics.top_n` (15) entries. A dashboard with 500 bars
is not a dashboard.

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
- **No drill-down from a chart.** A bar is a number, not a filter. The tables
  above it already filter server-side, so the path exists; joining them is
  polish rather than capability.
- **No date-range selector.** Everything is "as of the last run". Historic
  comparison is possible from `metric_snapshots`, which keeps every run, but
  nothing reads it that way yet.
