-- Etapa 5, parte 2: snapshot da taxa de comissão vigente no momento da conclusão do
-- atendimento — necessário pra Opção B (visão financeira pessoal de Profissional,
-- kind='own') calcular comissão de meses passados com a taxa que valia NA ÉPOCA, não
-- a taxa atual de team_members (que só guarda o valor corrente, sem histórico).
--
-- Verificação pré-migration (query_database, produção real, 06/09/2026):
--   1. team_members.commission_value é `numeric` sem precisão/escala fixa (não
--      numeric(10,2)) — as colunas novas usam o mesmo tipo, sem inventar precisão.
--   2. record_appointment_revenue() (pg_get_functiondef) confirmado idêntico ao texto
--      já documentado em 20260727220012_948c360a...sql — AFTER INSERT OR UPDATE,
--      dispara em (INSERT com status='completed') OU (UPDATE pra 'completed' vindo de
--      outro status). Esta migration usa exatamente a mesma condição de transição.
--   3. pg_trigger em appointments hoje: 2 BEFORE UPDATE (appointments_updated_at,
--      trg_appointments_enqueue_whatsapp) + 3 AFTER (consume_materials, enqueue_created,
--      record_appointment_revenue). Nenhum lê ou escreve as colunas novas — o trigger
--      desta migration é BEFORE (precisa ser, pra poder setar NEW.* antes do commit da
--      linha) e não tem nenhuma dependência de ordem com os outros BEFORE existentes
--      (cada um mexe em colunas disjuntas). Sem risco de ordem de execução.
--   4. Hoje existem só 3 appointments com status='completed' em produção, e NENHUM tem
--      professional_id preenchido — ou seja, não há histórico real que dependa do
--      snapshot ainda; tudo daqui pra frente é dado novo.
--
-- Casos de borda decididos/reportados (não implementados como lógica especial — são
-- consequência natural de usar a MESMA condição de transição do trigger de receita):
--   - Se um atendimento completado tem o status mudado e depois é completado de novo,
--     o snapshot é SOBRESCRITO com a taxa vigente na segunda conclusão (mesmo padrão
--     de "sobrescrever" já usado pra receita: o DELETE+INSERT de finance_transactions
--     também reflete só a conclusão mais recente).
--   - Se um atendimento JÁ completado tem só o professional_id trocado (sem sair de
--     'completed'), o snapshot NÃO é retocado — a condição exige
--     "OLD.status IS DISTINCT FROM 'completed'", que é falsa nesse caso. Isso é
--     consistente com o próprio trigger de receita, que também não gera uma nova
--     transação nesse cenário — nenhum dos dois "segue" uma reatribuição depois do
--     fato. Reportado como está, sem lógica adicional pra tratar esse caso — decisão
--     de produto em aberto se precisar mudar no futuro.
--
-- Sem backfill: atendimentos já completed antes desta migration ficam com as colunas
-- novas NULL — o código de leitura trata NULL como "sem snapshot" e cai pra taxa atual
-- de team_members, marcando o resultado como estimado (isEstimated: true).
--
-- Idempotente: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE FUNCTION, DROP TRIGGER IF
-- EXISTS antes do CREATE TRIGGER — seguro rodar de novo.

BEGIN;

-- =====================================================================================
-- 1 — colunas novas em appointments (mesmo tipo de team_members.commission_value/type)
-- =====================================================================================
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS commission_type_snapshot text,
  ADD COLUMN IF NOT EXISTS commission_value_snapshot numeric;

-- =====================================================================================
-- 2 — trigger BEFORE (precisa setar NEW.* antes da linha ser gravada), mesma condição
-- de transição do record_appointment_revenue() já existente — não o modifica, só roda
-- em paralelo, sem nenhuma dependência entre os dois.
-- =====================================================================================
CREATE OR REPLACE FUNCTION public.record_commission_snapshot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_type text;
  v_value numeric;
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.status = 'completed')
     OR (TG_OP = 'UPDATE' AND NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed') THEN
    IF NEW.professional_id IS NOT NULL THEN
      SELECT tm.commission_type, tm.commission_value INTO v_type, v_value
      FROM public.team_members tm
      WHERE tm.id = NEW.professional_id;

      NEW.commission_type_snapshot := v_type;
      NEW.commission_value_snapshot := v_value;
    END IF;
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_record_commission_snapshot ON public.appointments;
CREATE TRIGGER trg_record_commission_snapshot
  BEFORE INSERT OR UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.record_commission_snapshot();

COMMIT;

-- =====================================================================================
-- ROLLBACK (não executar junto — guardado aqui como referência caso precise reverter)
-- =====================================================================================
-- BEGIN;
-- DROP TRIGGER IF EXISTS trg_record_commission_snapshot ON public.appointments;
-- DROP FUNCTION IF EXISTS public.record_commission_snapshot();
-- ALTER TABLE public.appointments
--   DROP COLUMN IF EXISTS commission_type_snapshot,
--   DROP COLUMN IF EXISTS commission_value_snapshot;
-- COMMIT;
