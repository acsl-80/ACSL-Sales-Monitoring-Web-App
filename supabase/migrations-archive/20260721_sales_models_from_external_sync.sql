-- Sales models are now assigned to partners by the external CSV sync rather than
-- by a super admin in the web UI. That sync authenticates with an app token, so
-- there is no acting user to record: the two audit columns must accept NULL,
-- where NULL means "written by the external sync".
--
-- Non-destructive: no data is changed, and re-adding NOT NULL is the rollback
-- (after backfilling the sync-written rows to a real user).

ALTER TABLE public.organization_payment_models
  ALTER COLUMN assigned_by DROP NOT NULL;

ALTER TABLE public.payment_models
  ALTER COLUMN created_by DROP NOT NULL;

COMMENT ON COLUMN public.organization_payment_models.assigned_by IS
  'User who assigned the model; NULL when assigned by the external CSV sync.';

COMMENT ON COLUMN public.payment_models.created_by IS
  'User who created the model; NULL when auto-created as a stub by the external CSV sync.';

-- The sync reconciles entitlements per partner on every run, so it reads and
-- writes this table constantly. Keep the lookup by organization cheap.
CREATE INDEX IF NOT EXISTS organization_payment_models_organization_id_idx
  ON public.organization_payment_models (organization_id);
