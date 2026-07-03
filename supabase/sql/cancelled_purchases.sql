-- ============================================================================
-- Cancelled Purchases — run this in your Supabase SQL editor
-- ============================================================================
-- Adds a history table + two RPCs used by the "Cancel Purchase" flow on
-- Purchases from ACSL. Partner records are NOT touched.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.cancelled_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_transfer_id uuid,
  transaction_id text,
  organization_id uuid,
  partner_id text,
  partner_name text,
  state text,
  branch text,
  sales_factory text,
  sales_date date,
  transfer_date timestamptz,
  stove_count integer NOT NULL DEFAULT 0,
  stove_ids_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  cancellation_reason text NOT NULL,
  cancelled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.cancelled_purchases TO authenticated;
GRANT ALL ON public.cancelled_purchases TO service_role;

ALTER TABLE public.cancelled_purchases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "super_admin_select_cancelled_purchases" ON public.cancelled_purchases;
CREATE POLICY "super_admin_select_cancelled_purchases"
  ON public.cancelled_purchases FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'super_admin')
  );

DROP POLICY IF EXISTS "super_admin_insert_cancelled_purchases" ON public.cancelled_purchases;
CREATE POLICY "super_admin_insert_cancelled_purchases"
  ON public.cancelled_purchases FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'super_admin')
  );

CREATE INDEX IF NOT EXISTS idx_cancelled_purchases_cancelled_at
  ON public.cancelled_purchases (cancelled_at DESC);

-- ── check_purchase_cancellable ──────────────────────────────────────────────
-- Returns rows of blocking sales (empty when the transfer can be cancelled).
CREATE OR REPLACE FUNCTION public.check_purchase_cancellable(_transfer_id uuid)
RETURNS TABLE (
  stove_serial_no text,
  sales_reference text,
  sales_date date,
  partner_name text,
  sale_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _is_admin boolean;
  _stove_ids text[];
BEGIN
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  INTO _is_admin;
  IF NOT _is_admin THEN
    RAISE EXCEPTION 'Only super admins can cancel purchases';
  END IF;

  SELECT ARRAY(
    SELECT jsonb_array_elements(t.stove_ids)->>'stove_id'
    FROM public.stove_transfer_history t
    WHERE t.id = _transfer_id
  ) INTO _stove_ids;

  IF _stove_ids IS NULL OR array_length(_stove_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT s.stove_serial_no, s.transaction_id AS sales_reference, s.sales_date, s.partner_name, s.id
    FROM public.sales s
    WHERE s.stove_serial_no = ANY(_stove_ids)
      AND COALESCE(s.is_archived, false) = false;
END;
$$;

REVOKE ALL ON FUNCTION public.check_purchase_cancellable(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_purchase_cancellable(uuid) TO authenticated;

-- ── cancel_purchase ─────────────────────────────────────────────────────────
-- Atomically snapshots the transfer, deletes stove IDs, and removes the row.
-- Fails if any stove is still tied to a non-archived sale.
CREATE OR REPLACE FUNCTION public.cancel_purchase(_transfer_id uuid, _reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _is_admin boolean;
  _transfer public.stove_transfer_history%ROWTYPE;
  _stove_ids text[];
  _blocking_count integer;
  _new_id uuid;
BEGIN
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  INTO _is_admin;
  IF NOT _is_admin THEN
    RAISE EXCEPTION 'Only super admins can cancel purchases';
  END IF;

  IF _reason IS NULL OR length(btrim(_reason)) < 5 THEN
    RAISE EXCEPTION 'A cancellation reason of at least 5 characters is required';
  END IF;

  SELECT * INTO _transfer FROM public.stove_transfer_history WHERE id = _transfer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer % not found', _transfer_id;
  END IF;

  SELECT ARRAY(
    SELECT jsonb_array_elements(_transfer.stove_ids)->>'stove_id'
  ) INTO _stove_ids;

  IF _stove_ids IS NOT NULL AND array_length(_stove_ids, 1) IS NOT NULL THEN
    SELECT count(*) INTO _blocking_count
    FROM public.sales
    WHERE stove_serial_no = ANY(_stove_ids)
      AND COALESCE(is_archived, false) = false;

    IF _blocking_count > 0 THEN
      RAISE EXCEPTION 'Cannot cancel: % stove(s) are still tied to active sales', _blocking_count;
    END IF;
  END IF;

  INSERT INTO public.cancelled_purchases (
    original_transfer_id, transaction_id, organization_id, partner_id, partner_name,
    state, branch, sales_factory, sales_date, transfer_date,
    stove_count, stove_ids_snapshot, cancellation_reason, cancelled_by
  ) VALUES (
    _transfer.id, _transfer.transaction_id, _transfer.organization_id, _transfer.partner_id, _transfer.partner_name,
    _transfer.state, _transfer.branch, _transfer.sales_factory, _transfer.sales_date, _transfer.transfer_date,
    COALESCE(_transfer.stove_count, 0), COALESCE(_transfer.stove_ids, '[]'::jsonb), btrim(_reason), auth.uid()
  ) RETURNING id INTO _new_id;

  IF _stove_ids IS NOT NULL AND array_length(_stove_ids, 1) IS NOT NULL AND _transfer.organization_id IS NOT NULL THEN
    DELETE FROM public.stove_ids_base
    WHERE stove_id = ANY(_stove_ids)
      AND organization_id = _transfer.organization_id
      AND sale_id IS NULL;
  END IF;

  DELETE FROM public.stove_transfer_history WHERE id = _transfer_id;

  RETURN _new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_purchase(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_purchase(uuid, text) TO authenticated;
