-- ============================================================================
-- Migration: Payment Models Feature
-- Date: 2026-03-10
-- Description: Creates tables for installment payment models, org assignments,
--              installment payment tracking, and adds columns to sales table.
-- ============================================================================

-- ─── 1. payment_models table ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payment_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  duration_months INTEGER NOT NULL,
  fixed_price NUMERIC(12,2) NOT NULL,
  min_down_payment NUMERIC(12,2) DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for active models lookup
CREATE INDEX IF NOT EXISTS idx_payment_models_is_active ON public.payment_models(is_active);

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_payment_models_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_payment_models_updated_at
  BEFORE UPDATE ON public.payment_models
  FOR EACH ROW
  EXECUTE FUNCTION update_payment_models_updated_at();

-- RLS
ALTER TABLE public.payment_models ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_full_access" ON public.payment_models
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_read_active" ON public.payment_models
  FOR SELECT USING (is_active = true);

-- ─── 2. organization_payment_models junction table ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.organization_payment_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  payment_model_id UUID NOT NULL REFERENCES public.payment_models(id) ON DELETE CASCADE,
  assigned_by UUID NOT NULL REFERENCES public.profiles(id),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, payment_model_id)
);

CREATE INDEX IF NOT EXISTS idx_org_payment_models_org_id ON public.organization_payment_models(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_payment_models_model_id ON public.organization_payment_models(payment_model_id);

-- RLS
ALTER TABLE public.organization_payment_models ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_full_access" ON public.organization_payment_models
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "org_members_read_own" ON public.organization_payment_models
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM public.profiles WHERE id = auth.uid()
    )
  );

-- ─── 3. installment_payments table ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.installment_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'transfer', 'pos')),
  proof_image_url TEXT,
  proof_image_id UUID REFERENCES public.uploads(id),
  notes TEXT,
  recorded_by UUID NOT NULL REFERENCES public.profiles(id),
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_installment_payments_sale_id ON public.installment_payments(sale_id);
CREATE INDEX IF NOT EXISTS idx_installment_payments_recorded_by ON public.installment_payments(recorded_by);

-- RLS
ALTER TABLE public.installment_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_full_access" ON public.installment_payments
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "service_role_access" ON public.installment_payments
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "org_members_read_own_sales" ON public.installment_payments
  FOR SELECT USING (
    sale_id IN (
      SELECT s.id FROM public.sales s
      WHERE s.organization_id IN (
        SELECT organization_id FROM public.profiles WHERE id = auth.uid()
      )
    )
  );

CREATE POLICY "org_members_insert_own_sales" ON public.installment_payments
  FOR INSERT WITH CHECK (
    sale_id IN (
      SELECT s.id FROM public.sales s
      WHERE s.organization_id IN (
        SELECT organization_id FROM public.profiles WHERE id = auth.uid()
      )
    )
  );

-- ─── 4. ALTER sales table ──────────────────────────────────────────────────────
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS is_installment BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS payment_model_id UUID REFERENCES public.payment_models(id),
  ADD COLUMN IF NOT EXISTS total_paid NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'not_applicable';

-- Add check constraint for payment_status (only if not already existing)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'sales_payment_status_check'
    AND table_name = 'sales'
  ) THEN
    ALTER TABLE public.sales
      ADD CONSTRAINT sales_payment_status_check
      CHECK (payment_status IN ('not_applicable', 'partially_paid', 'fully_paid'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sales_payment_status ON public.sales(payment_status);
CREATE INDEX IF NOT EXISTS idx_sales_is_installment ON public.sales(is_installment);
CREATE INDEX IF NOT EXISTS idx_sales_payment_model_id ON public.sales(payment_model_id);
