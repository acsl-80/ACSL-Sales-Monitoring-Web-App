# Table 1 at 500,000 rows: what was measured

Every number here comes from a local Postgres holding **500,000 synthetic
sales**, seeded by `scripts/seed-data-center.sql`. Production holds 38, so none
of this could be proven against real data. That is why the seed is a
deliverable rather than a convenience.

Reproduce it:

```bash
docker exec -i supabase_db_<project> psql -U postgres -d postgres < scripts/seed-data-center.sql
```

(after `set data_center.seed_ok = 'yes';` in the same session)

---

## Paging is flat, which is the whole point

| Query | Plan | Time |
|---|---|---|
| First page, 51 rows | Index scan, 51 rows read | **2.7 ms** |
| Page ~8,000 (cursor 400,000 rows in) | Index scan, 51 rows read | **1.0 ms** |
| The same depth expressed as `OFFSET 400000` | Parallel sequential scan, **400,051 rows read** | **505.5 ms** |

The deep page is not slower than the first page. It reads the same 51 rows,
because a keyset cursor turns "page 8,000" into a range scan that starts where
the last page stopped. The offset form has to walk and discard 400,000 rows to
return 50, and it gets worse every time the table grows.

This is why `records-query.ts` exposes no `offset` and no `page` parameter at
all. Not documented as discouraged: absent, so it cannot be reintroduced by a
caller.

## The index earns its place

Dropping `idx_sales_sales_date_id` and re-running the same deep page:

| | Plan | Time |
|---|---|---|
| With the index | Index scan, 51 rows | **0.5 ms** |
| Without it | Parallel sequential scan, 80,004 rows | **173.0 ms** |

Roughly 300 times slower, and the gap widens with row count. Recorded here so
the index is a decision with a number attached rather than folklore.

## Search needed a second index, and this is the number that decided it

The design said the module would add exactly one index to `public`. Search broke
that, and the measurement is the argument:

| | Plan | Time |
|---|---|---|
| `ilike '%term%'` across six columns | Parallel sequential scan | **1,088.5 ms** |
| The same search, one GIN trigram index on the concatenation | Bitmap index scan | **10.9 ms** |

A second per keystroke is not a search box. Migration
`20260819050000_data_center_sales_search_index.sql` adds one GIN index over a
single concatenated expression rather than six per-column indexes, so the write
cost is one index and not six.

The catch, written down because it fails silently: the query in
`records-query.ts` must repeat that expression exactly. If they drift, search
still returns correct results and quietly reverts to 1,089 ms.

## Filters stay on the index

| Filter | Time |
|---|---|
| State plus sale status | 25.1 ms |
| Date range | within the same envelope |

Both still resolve through `idx_sales_sales_date_id`, because the sort key is
what bounds the scan and the filters narrow it.

---

## End to end, through the edge function

SQL time is not user time. These are full round trips through
`data-center-read`, including auth, scope resolution and JSON:

| Call | Time |
|---|---|
| First page, 50 rows | 122 ms |
| Page at cursor 400,000 rows in | **111 ms** |
| Search by phone fragment | 177 ms |
| Filter by state and status | 149 ms |

The deep page is again no slower than the first. The roughly 110 ms floor is
function invocation and network, not the query.

## Correctness of the cursor, not just its speed

Walked 21 consecutive pages of 50:

- **1,050 distinct rows, 0 duplicates.** No row was returned twice and none was
  skipped between pages.
- Sale dates never moved backwards across a page boundary.

That matters more than the timings. A fast cursor that loses rows is worse than
a slow offset, and the loss would be invisible without checking.

## Limits are enforced, not requested

| Probe | Result |
|---|---|
| Ask for 100,000 rows in one page | 200 returned (the ceiling) |
| Unknown `saleStatus` value | rejected, 400 |
| Malformed cursor | rejected, 400 |

---

## One bug this exercise found

Scoped reads failed with `column v.sold_on_behalf_of does not exist`. A super
admin never hit it, because their branch of the scope rule needs no column at
all. It appeared the moment a viewer and an editor were tested, and is fixed by
migration `20260819060000_data_center_view_attribution.sql`.

Worth recording as a pattern: testing only the role that bypasses the check
proves nothing about the check.

## What is not proven here

- **The 500k set is local only.** The preview branch project carries the small
  preview seed, so the preview demonstrates that the module works, not that it
  works at capacity. Those are two different claims and only the first is
  provable on the preview today.
- **Render cost is bounded by construction, not measured under a profiler.**
  The table renders a window of roughly thirty rows regardless of how many are
  loaded (`useVirtualRows.ts`), but no frame timings were captured.
- **Concurrency.** Every number above is a single query on an idle database.

---

## Filtering, once there is something to filter by

Phase 17 opened the filters the server always accepted but only a dashboard
drill could reach: partner, sales rep on the transfer, buyer's state and LGA,
who recorded the sale, sales model, channel, archived.

`idx_sales_sales_date_id` serves the paging keyset perfectly **while nothing is
filtered**. Add a filter and the planner still drives the date index, throwing
away every row that does not match until it has a page. For a partner holding
2% of sales that is fifty times the work; for a state with a handful of buyers
it is a table scan wearing a `LIMIT`.

So the filter column goes first and the paging columns after it, which makes a
filtered page the same indexed read an unfiltered one is:

| Index | Serves |
|---|---|
| `idx_sales_org_date_id` | one partner, paged |
| `idx_sales_state_lga_date_id` | one state (leading column), or state + LGA |
| `idx_sales_created_by_date_id` | one sales agent |
| `change_log_record_idx` | one record's edit history |

Sales model and channel get no index on purpose. Four models and two channels
means a filtered scan of the date index matches roughly one row in four, which
the existing index already serves; an index per low-cardinality column costs
write time on the sales app's own table and buys nothing.

`CREATE INDEX CONCURRENTLY` forms are in
`supabase/manual/20260822_records_filter_indexes_concurrently.sql`. Run those
first on any database being written to; the migration's statements are
`if not exists` and will then find them built.

### The rep filter that could never have matched

Worth recording because nothing about it looked wrong. The filter read:

```sql
s.transaction_id in (select h.transaction_id from stove_transfer_history h ...)
```

Both columns are called `transaction_id`. They are not the same reference. A
sale's is the sale's own ("PRV001"); a transfer's is the consignment's
("TR-PRV002"), and it reaches a sale through `stove_ids_base.sales_reference`,
never directly. The two sets never intersect, so the sales-rep scorecard's
drill-through opened an empty table every time and looked exactly like a rep
with no sales.

The chain is now the one CLAUDE.md names, and a test asserts that at least one
rep reaches at least one sale — because "every rep matches nothing" is
indistinguishable from "no results" at the UI.

---

## How many match, without counting half a million rows

The header used to say "100 loaded, more available", which is a fact about the
browser rather than about the filter. It now says how many match.

A plain `count(*)` cannot stop early, so an unfiltered count at 500,000 rows
would walk 500,000 index entries every time somebody opened the page. The count
is instead the pick statement wrapped in a `LIMIT 10000` and counted:

```sql
select count(*) from (select 1 from public.sales s where ... limit 10000) capped
```

Bounded by the ceiling whatever the table holds. Above it the answer is
`10,000+`, which is the answer somebody acts on anyway — nobody scrolls to row
forty thousand, they narrow the filter.

Asked once per filter, never per page. The count is built from the where clause
**before** the cursor predicate is appended, so it answers "how many match"
rather than "how many are left below where I am" — otherwise the total would
count down as somebody scrolled, which reads as records disappearing.

---

## Why the table stops loading at 5,000 rows

The list is virtualized, so the DOM was never the problem. The array behind it
is: every page fetched is appended and kept, and an idle scroll-wheel at
500,000 records walks a tab into holding half a million row objects.

`MAX_RETAINED = 5,000` is about 5 MB of row objects and roughly a hundred pages
of scrolling. Past it the table stops fetching and says so, with the match
count beside it and two things to do about it: narrow the filters, or turn the
sort round and read from the other end.

Sort direction exists for that second option. The table pages forward only, so
before it the oldest record in the register was reachable solely by scrolling
past every newer one.
