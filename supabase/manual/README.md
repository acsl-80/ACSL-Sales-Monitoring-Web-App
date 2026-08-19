# Manual scripts

Not run by the migration runner. Each file here exists because it cannot run
inside a transaction, and the runner wraps every migration in one.

Run these by hand against production, in the SQL editor or via psql, and record
that you did.

## 20260819_sales_queue_index_concurrently.sql

Builds `idx_sales_sales_date_id` on `public.sales` with `CONCURRENTLY`, so the
live Sell Stove path keeps working while the index is built.

Run it **before** deploying the Data Center migrations to production. Afterwards
`20260819030000_data_center_sales_queue_index.sql` becomes a no-op there,
because it is guarded with `IF NOT EXISTS`.

Verify immediately after. A `CONCURRENTLY` build that fails leaves an INVALID
index behind, which is dead weight that also blocks a rebuild:

```sql
select i.indisvalid, c.relname
from pg_index i join pg_class c on c.oid = i.indexrelid
where c.relname = 'idx_sales_sales_date_id';
```

`indisvalid` must be true. If it is false, `drop index concurrently
public.idx_sales_sales_date_id;` and investigate before retrying.
