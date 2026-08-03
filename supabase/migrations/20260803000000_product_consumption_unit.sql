-- Um produto pode ser comprado/estocado numa unidade (ex.: ml) e consumido por
-- atendimento numa unidade menor (ex.: gotas). consumption_unit/consumption_ratio
-- guardam essa conversão de forma opcional e genérica (não específica de gotas):
-- "1 unidade de estoque = consumption_ratio unidades de consumption_unit".
-- Quando NULL, o produto continua se comportando exatamente como antes (consumo
-- registrado na mesma unidade do estoque).
ALTER TABLE public.products
  ADD COLUMN consumption_unit text,
  ADD COLUMN consumption_ratio numeric;

ALTER TABLE public.products
  ADD CONSTRAINT products_consumption_ratio_positive
  CHECK (consumption_ratio IS NULL OR consumption_ratio > 0);

-- Substitui a função de consumo: quando o produto tem consumption_ratio, a
-- quantidade registrada na ficha técnica / ajuste manual (em unidade de consumo,
-- ex.: gotas) é convertida para unidade de estoque (ex.: ml) antes de tocar em
-- products.stock e em stock_movements. stock_movements sempre grava a quantidade
-- já convertida (ml) — é o registro histórico real do que saiu do estoque, e não
-- muda retroativamente se a taxa de conversão do produto for editada depois.
CREATE OR REPLACE FUNCTION public.consume_appointment_materials()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m RECORD;
  has_override boolean;
  stock_qty numeric;
BEGIN
  -- Became completed
  IF (TG_OP = 'INSERT' AND NEW.status = 'completed')
     OR (TG_OP = 'UPDATE' AND NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed') THEN
    SELECT EXISTS (SELECT 1 FROM public.appointment_materials WHERE appointment_id = NEW.id) INTO has_override;

    IF has_override THEN
      FOR m IN SELECT am.product_id, am.quantity, p.cost_per_unit, p.consumption_ratio
               FROM public.appointment_materials am
               JOIN public.products p ON p.id = am.product_id
               WHERE am.appointment_id = NEW.id LOOP
        IF m.quantity > 0 THEN
          stock_qty := m.quantity / COALESCE(NULLIF(m.consumption_ratio, 0), 1);
          UPDATE public.products SET stock = stock - stock_qty WHERE id = m.product_id;
          INSERT INTO public.stock_movements (owner_id, product_id, appointment_id, kind, quantity, unit_cost, note)
          VALUES (NEW.owner_id, m.product_id, NEW.id, 'consumption', -stock_qty, m.cost_per_unit, 'Atendimento concluído (ajustado manualmente)');
        END IF;
      END LOOP;
    ELSIF NEW.service_id IS NOT NULL THEN
      FOR m IN SELECT sm.product_id, sm.quantity, p.cost_per_unit, p.consumption_ratio
               FROM public.service_materials sm
               JOIN public.products p ON p.id = sm.product_id
               WHERE sm.service_id = NEW.service_id AND sm.owner_id = NEW.owner_id LOOP
        stock_qty := m.quantity / COALESCE(NULLIF(m.consumption_ratio, 0), 1);
        UPDATE public.products SET stock = stock - stock_qty WHERE id = m.product_id;
        INSERT INTO public.stock_movements (owner_id, product_id, appointment_id, kind, quantity, unit_cost, note)
        VALUES (NEW.owner_id, m.product_id, NEW.id, 'consumption', -stock_qty, m.cost_per_unit, 'Atendimento concluído');
      END LOOP;
    END IF;
  END IF;

  -- Reverted from completed — não muda: já lê de stock_movements, que está sempre em
  -- unidade de estoque, então funciona igual pra produtos com ou sem conversão.
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
