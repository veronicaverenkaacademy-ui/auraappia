
-- PRODUCTS
CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  name text NOT NULL,
  brand text,
  unit text NOT NULL DEFAULT 'un',
  stock numeric NOT NULL DEFAULT 0,
  min_stock numeric NOT NULL DEFAULT 0,
  cost_per_unit numeric NOT NULL DEFAULT 0,
  last_purchase_cost numeric,
  last_purchase_qty numeric,
  supplier text,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY products_own_all ON public.products FOR ALL TO authenticated
  USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE TRIGGER products_updated_at BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- SERVICE MATERIALS (ficha técnica)
CREATE TABLE public.service_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity numeric NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (service_id, product_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_materials TO authenticated;
GRANT ALL ON public.service_materials TO service_role;
ALTER TABLE public.service_materials ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_materials_own_all ON public.service_materials FOR ALL TO authenticated
  USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

-- STOCK MOVEMENTS
CREATE TABLE public.stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  kind text NOT NULL, -- 'purchase' | 'consumption' | 'adjustment' | 'reversal'
  quantity numeric NOT NULL, -- positive in, negative out
  unit_cost numeric,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_movements TO authenticated;
GRANT ALL ON public.stock_movements TO service_role;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY stock_movements_own_all ON public.stock_movements FOR ALL TO authenticated
  USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

-- Auto-consume materials on appointment completion
CREATE OR REPLACE FUNCTION public.consume_appointment_materials()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m RECORD;
BEGIN
  -- Became completed
  IF (TG_OP = 'INSERT' AND NEW.status = 'completed')
     OR (TG_OP = 'UPDATE' AND NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed') THEN
    IF NEW.service_id IS NOT NULL THEN
      FOR m IN SELECT sm.product_id, sm.quantity, p.cost_per_unit
               FROM public.service_materials sm
               JOIN public.products p ON p.id = sm.product_id
               WHERE sm.service_id = NEW.service_id AND sm.owner_id = NEW.owner_id LOOP
        UPDATE public.products SET stock = stock - m.quantity WHERE id = m.product_id;
        INSERT INTO public.stock_movements (owner_id, product_id, appointment_id, kind, quantity, unit_cost, note)
        VALUES (NEW.owner_id, m.product_id, NEW.id, 'consumption', -m.quantity, m.cost_per_unit, 'Atendimento concluído');
      END LOOP;
    END IF;
  END IF;

  -- Reverted from completed
  IF TG_OP = 'UPDATE' AND OLD.status = 'completed' AND NEW.status IS DISTINCT FROM 'completed' THEN
    FOR m IN SELECT product_id, SUM(quantity) AS qty
             FROM public.stock_movements
             WHERE appointment_id = NEW.id AND kind = 'consumption'
             GROUP BY product_id LOOP
      UPDATE public.products SET stock = stock - m.qty WHERE id = m.product_id; -- qty is negative, so this adds back
      INSERT INTO public.stock_movements (owner_id, product_id, appointment_id, kind, quantity, note)
      VALUES (NEW.owner_id, m.product_id, NEW.id, 'reversal', -m.qty, 'Atendimento reaberto');
    END LOOP;
  END IF;

  RETURN NEW;
END; $$;

CREATE TRIGGER appointments_consume_materials
AFTER INSERT OR UPDATE OF status ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.consume_appointment_materials();
