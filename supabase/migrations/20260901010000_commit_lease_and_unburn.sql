-- The commit lease, and amnesty for rows the old race burned.
--
-- WHY A LEASE AND NOT AN ADVISORY LOCK
--
-- Commit needs single-flight: exactly one driver working a batch at a time.
-- The module's usual answer is an advisory lock, but its data layer opens a
-- fresh Postgres connection per statement, and an advisory lock lives and dies
-- with its connection (or its transaction). It can guard the milliseconds of
-- one claim transaction; it cannot span the minutes a commit link spends
-- calling create-sale between statements. For the other 99% of a link's wall
-- clock the lock would be free, "busy" would almost never be true, and a
-- second driver - a stale Continue press, the confirmation queue - would fork
-- a second stream against the same rows.
--
-- A lease is a timestamp taken by compare-and-swap, so it holds exactly as
-- long as it says it holds, across any number of connections:
--
--   update data_center.import_batches
--      set commit_lease_until = now() + interval '7 minutes'
--    where id = $1
--      and state = 'validated'
--      and (commit_lease_until is null or commit_lease_until < now())
--   returning id;
--
-- No row back means another driver holds the batch: answer {busy}. The
-- `state = 'validated'` predicate is load-bearing - it is also the fence that
-- stops a commit link starting while a rollback has moved the batch on, and
-- rollback checks the lease in the other direction before it touches rows.
-- Each link clears its own lease as it hands over to the next, and an expired
-- lease (a crashed link) simply loses the CAS to the next press.

alter table data_center.import_batches
  add column commit_lease_until timestamptz;

comment on column data_center.import_batches.commit_lease_until is
  'Single-flight lease for the commit chain. Held by CAS: a driver may work '
  'the batch only while its lease stands, and takes the lease only when none '
  'stands. Cleared on handover to the next link; an expired lease is a crashed '
  'link and is simply taken over.';

-- The slice budget: commit stops STARTING new create-sale calls once this much
-- of the invocation has elapsed. Replaces slice_size as the governor -
-- measured per-sale latency on production swings 4s to 30s within one day, so
-- no fixed row count can be right. slice_size remains as an upper cap only.
insert into data_center.workflow_config (key, value, description) values
  ('import.slice_budget_ms', '15000'::jsonb,
   'Milliseconds of create-sale work per commit link. The link stops picking '
   'up new rows past this and hands over to the next link. Per-sale latency '
   'varies too much for a row count to govern; import.slice_size is only a cap.')
on conflict (key) do nothing;

-- Amnesty for the race the lease now prevents.
--
-- Two overlapping commit drivers used to select the same rows; the loser of
-- the per-stove claim marked its row exception with this exact reason -
-- permanently, even though nothing was wrong with the row. The new commit
-- skips instead. Rows already burned: where the stove was never actually
-- sold, the row goes back to the pool; where it genuinely was, the reason is
-- rewritten to the truth so an operator reading it acts on facts.
--
-- Measured on production before writing this: exactly one such row exists and
-- its stove is genuinely sold, so today this flips nothing and rewrites one
-- reason. It ships as the guard for any row burned between measurement and
-- deploy.
update data_center.import_rows r
   set status = 'valid', exception_reason = null
 where r.status = 'exception'
   and r.exception_reason = 'Another import is already committing this stove'
   and not exists (select 1 from public.stove_ids_base sb
                    where upper(sb.stove_id) = upper(r.stove_serial_no)
                      and sb.sale_id is not null);

update data_center.import_rows r
   set exception_reason = 'This stove was already sold by the time the row was tried'
 where r.status = 'exception'
   and r.exception_reason = 'Another import is already committing this stove'
   and exists (select 1 from public.stove_ids_base sb
                where upper(sb.stove_id) = upper(r.stove_serial_no)
                  and sb.sale_id is not null);
