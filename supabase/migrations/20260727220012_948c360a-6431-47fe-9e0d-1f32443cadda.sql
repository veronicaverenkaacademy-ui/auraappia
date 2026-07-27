
-- finance_transactions
CREATE TABLE public.finance_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('income','expense')),
  amount numeric NOT NULL DEFAULT 0,
  category text,
  method text CHECK (method IN ('pix','card_credit','card_debit','cash','transfer','link','wallet') OR method IS NULL),
  status text NOT NULL DEFAULT 'paid' CHECK (status IN ('paid','pending','scheduled','cancelled')),
  due_date date,
  paid_at timestamptz,
  description text,
  client_id uuid,
  appointment_id uuid,
  service_id uuid,
  installments integer NOT NULL DEFAULT 1,
  installment_index integer,
  parent_id uuid,
  auto boolean NOT NULL DEFAULT false,
  tags text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.finance_transactions TO authenticated;
GRANT ALL ON public.finance_transactions TO service_role;
ALTER TABLE public.finance_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY finance_tx_own_all ON public.finance_transactions FOR ALL TO authenticated
  USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE INDEX ix_finance_tx_owner_paid_at ON public.finance_transactions(owner_id, paid_at DESC);
CREATE INDEX ix_finance_tx_owner_due ON public.finance_transactions(owner_id, due_date);
CREATE INDEX ix_finance_tx_appt ON public.finance_transactions(appointment_id);
CREATE TRIGGER trg_finance_tx_updated BEFORE UPDATE ON public.finance_transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- finance_goals
CREATE TABLE public.finance_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  period text NOT NULL CHECK (period IN ('day','week','month','year')),
  amount numeric NOT NULL DEFAULT 0,
  starts_at date NOT NULL DEFAULT (now()::date),
  ends_at date,
  scope text NOT NULL DEFAULT 'global' CHECK (scope IN ('global','service','category','professional')),
  scope_ref text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.finance_goals TO authenticated;
GRANT ALL ON public.finance_goals TO service_role;
ALTER TABLE public.finance_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY finance_goals_own_all ON public.finance_goals FOR ALL TO authenticated
  USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE TRIGGER trg_finance_goals_updated BEFORE UPDATE ON public.finance_goals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- finance_settings
CREATE TABLE public.finance_settings (
  owner_id uuid PRIMARY KEY,
  tax_regime text DEFAULT 'MEI',
  tax_pct numeric NOT NULL DEFAULT 6,
  prolabore_monthly numeric NOT NULL DEFAULT 0,
  commission_default_pct numeric NOT NULL DEFAULT 0,
  fixed_costs_monthly numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.finance_settings TO authenticated;
GRANT ALL ON public.finance_settings TO service_role;
ALTER TABLE public.finance_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY finance_settings_own_all ON public.finance_settings FOR ALL TO authenticated
  USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE TRIGGER trg_finance_settings_updated BEFORE UPDATE ON public.finance_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto revenue on appointment completion
CREATE OR REPLACE FUNCTION public.record_appointment_revenue()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.status = 'completed')
     OR (TG_OP = 'UPDATE' AND NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed') THEN
    INSERT INTO public.finance_transactions
      (owner_id, kind, amount, category, status, paid_at, description, client_id, appointment_id, service_id, auto)
    VALUES
      (NEW.owner_id, 'income', COALESCE(NEW.price, 0), 'Atendimento', 'paid', now(),
       COALESCE(NEW.service_name, 'Atendimento'), NEW.client_id, NEW.id, NEW.service_id, true);
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'completed' AND NEW.status IS DISTINCT FROM 'completed' THEN
    DELETE FROM public.finance_transactions
      WHERE appointment_id = NEW.id AND auto = true AND kind = 'income';
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_record_appointment_revenue ON public.appointments;
CREATE TRIGGER trg_record_appointment_revenue
  AFTER INSERT OR UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.record_appointment_revenue();
