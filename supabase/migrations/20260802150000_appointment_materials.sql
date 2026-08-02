-- Ajuste manual de materiais por atendimento: a ficha técnica do serviço
-- (service_materials) continua sendo a estimativa padrão, mas a profissional pode
-- registrar o consumo real de um atendimento específico sem alterar a ficha técnica
-- que vale pros próximos atendimentos do mesmo serviço.

CREATE TABLE public.appointment_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (appointment_id, product_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.appointment_materials TO authenticated;
GRANT ALL ON public.appointment_materials TO service_role;
ALTER TABLE public.appointment_materials ENABLE ROW LEVEL SECURITY;
CREATE POLICY appointment_materials_own_all ON public.appointment_materials FOR ALL TO authenticated
  USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE INDEX appointment_materials_appointment_idx ON public.appointment_materials(appointment_id);

-- Substitui a função existente: ao concluir, prefere o ajuste manual (appointment_materials)
-- quando ele existir para o atendimento; senão, cai na ficha técnica padrão (service_materials),
-- exatamente como antes. A parte de reversão (desmarcar conclusão) não muda — ela já lê
-- de stock_movements, não da ficha técnica, então funciona igual pros dois casos.
CREATE OR REPLACE FUNCTION public.consume_appointment_materials()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m RECORD;
  has_override boolean;
BEGIN
  -- Became completed
  IF (TG_OP = 'INSERT' AND NEW.status = 'completed')
     OR (TG_OP = 'UPDATE' AND NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed') THEN
    SELECT EXISTS (SELECT 1 FROM public.appointment_materials WHERE appointment_id = NEW.id) INTO has_override;

    IF has_override THEN
      FOR m IN SELECT am.product_id, am.quantity, p.cost_per_unit
               FROM public.appointment_materials am
               JOIN public.products p ON p.id = am.product_id
               WHERE am.appointment_id = NEW.id LOOP
        IF m.quantity > 0 THEN
          UPDATE public.products SET stock = stock - m.quantity WHERE id = m.product_id;
          INSERT INTO public.stock_movements (owner_id, product_id, appointment_id, kind, quantity, unit_cost, note)
          VALUES (NEW.owner_id, m.product_id, NEW.id, 'consumption', -m.quantity, m.cost_per_unit, 'Atendimento concluído (ajustado manualmente)');
        END IF;
      END LOOP;
    ELSIF NEW.service_id IS NOT NULL THEN
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
