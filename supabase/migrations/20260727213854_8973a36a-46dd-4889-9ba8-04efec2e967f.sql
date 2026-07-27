-- SUPPLIERS
CREATE TABLE public.suppliers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  name text not null,
  contact_name text,
  whatsapp text,
  instagram text,
  website text,
  email text,
  phone text,
  cnpj text,
  address text,
  avg_delivery_days integer,
  rating smallint,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.suppliers TO authenticated;
GRANT ALL ON public.suppliers TO service_role;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY suppliers_own_all ON public.suppliers FOR ALL TO authenticated
  USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE TRIGGER trg_suppliers_updated BEFORE UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- PRODUCTS extensions
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS subcategory text,
  ADD COLUMN IF NOT EXISTS sku text,
  ADD COLUMN IF NOT EXISTS barcode text,
  ADD COLUMN IF NOT EXISTS internal_code text,
  ADD COLUMN IF NOT EXISTS ideal_stock numeric,
  ADD COLUMN IF NOT EXISTS max_stock numeric,
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS yield_per_unit numeric,
  ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL;

-- PRODUCT BATCHES
CREATE TABLE public.product_batches (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  product_id uuid not null REFERENCES public.products(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  batch_number text,
  manufactured_at date,
  expires_at date,
  initial_quantity numeric not null default 0,
  remaining_quantity numeric not null default 0,
  unit_cost numeric,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_batches TO authenticated;
GRANT ALL ON public.product_batches TO service_role;
ALTER TABLE public.product_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY product_batches_own_all ON public.product_batches FOR ALL TO authenticated
  USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE TRIGGER trg_product_batches_updated BEFORE UPDATE ON public.product_batches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX IF NOT EXISTS idx_product_batches_product ON public.product_batches(product_id);
CREATE INDEX IF NOT EXISTS idx_product_batches_expiry ON public.product_batches(owner_id, expires_at);

-- STOCK MOVEMENTS helpful indexes
CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON public.stock_movements(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_owner ON public.stock_movements(owner_id, created_at DESC);