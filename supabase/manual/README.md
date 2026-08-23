# Manual scripts

Not run by the migration runner. Each file here exists because it cannot run
inside a transaction, and the runner wraps every migration in one.

Run these by hand against production, in the SQL editor or via psql, and record
that you did.

## Order, and why it matters less than it reads

Run all five **before** deploying the Data Center migrations. Afterwards the
migration counterparts become no-ops, because every one is guarded with
`IF NOT EXISTS`.

The usual reason given is that a non-concurrent `CREATE INDEX` takes a SHARE
lock and blocks writes to `public.sales`, taking the Sell Stove path down for
the length of the build. That is true, and today it is nearly free: production
holds 44 sales, so every one of these builds in milliseconds.

**The real rule is the one that outlives that number.** These indexes have to
exist before the receipt backlog is imported, not after. Import fifty thousand
rows first and then run the GIN trigram build non-concurrently, and the stall
everybody was bracing for is exactly what happens. Run them while the table is
small and the question never arises.

One of them has no migration counterpart at all:
`20260823_stock_age_index_concurrently.sql`. Skip it and the stock ageing page
silently degrades to a sequential scan over `public.stove_ids_base` with
nothing to fall back on.

## The scripts

| File | Builds |
|---|---|
| `20260819_sales_queue_index_concurrently.sql` | `idx_sales_sales_date_id` on `public.sales` |
| `20260819_sales_search_trgm_concurrently.sql` | `pg_trgm` extension, then `idx_sales_search_trgm` on `public.sales` |
| `20260821_sales_phone_tail_concurrently.sql` | `idx_sales_phone_tail` on `public.sales` |
| `20260822_records_filter_indexes_concurrently.sql` | `idx_sales_org_date_id`, `idx_sales_state_lga_date_id`, `idx_sales_created_by_date_id` on `public.sales`, and `change_log_record_idx` on `data_center.change_log` |
| `20260823_stock_age_index_concurrently.sql` | `idx_stove_ids_unsold_age` on `public.stove_ids_base` |

## Verify all seven indexes, in one query

Run this immediately after the scripts, not the next morning.

A `CONCURRENTLY` build that fails leaves an **INVALID** index behind. That is
worse than no index: it is dead weight the planner will not use, and
`IF NOT EXISTS` then skips it forever, so a rebuild never happens and nothing
anywhere says so. This check is the only thing standing between that and a
page that is quietly slow for a year.

```sql
select expected.name,
       coalesce(i.indisvalid, false) as valid,
       case
         when i.indexrelid is null      then 'MISSING - the script did not run'
         when i.indisvalid is not true  then 'INVALID - drop and rebuild'
         else 'ok'
       end as verdict
  from (values
         ('idx_sales_sales_date_id'),
         ('idx_sales_search_trgm'),
         ('idx_sales_phone_tail'),
         ('idx_sales_org_date_id'),
         ('idx_sales_state_lga_date_id'),
         ('idx_sales_created_by_date_id'),
         ('change_log_record_idx'),
         ('idx_stove_ids_unsold_age')
       ) as expected(name)
  left join pg_class c on c.relname = expected.name
  left join pg_index i on i.indexrelid = c.oid
 order by valid, expected.name;
```

Every row must read `ok`. For any row that does not:

```sql
drop index concurrently if exists <schema>.<name>;
```

then investigate before retrying. `pg_trgm` also has to be present for
`idx_sales_search_trgm` to build at all:

```sql
select extname from pg_extension where extname = 'pg_trgm';
```

Production did not have it as of 2026-08-23; the search script installs it.
