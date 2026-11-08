-- ROLLBACK de 20261107150000_agenda_removed_and_reactivate.sql — remove as
-- duas funções e as duas colunas novas por completo (DROP FUNCTION/COLUMN
-- IF EXISTS — idempotente, seguro rodar de novo ou mesmo se a migration
-- nunca tiver sido aplicada).
--
-- Depois deste rollback:
--   - App ANTIGO (antes da Fase D): continua funcionando sem nenhuma
--     mudança — ele nunca leu agenda_removed_at/by nem chamou as funções
--     novas.
--   - App NOVO (com o código da Fase D, se ainda não tiver sido revertido
--     também): cai no modo de compatibilidade da Etapa D2.8 — a consulta
--     da Agenda detecta a coluna ausente e refaz sem ela (nada escondido),
--     e "Reativar"/"Remover da agenda" mostram a mensagem genérica de erro
--     ("Não foi possível concluir agora") em vez de quebrar a tela.
--
-- DROP COLUMN aqui apaga qualquer dado gravado nessas colunas DEPOIS da
-- migration ter sido aplicada (nenhum dado anterior existia, por serem
-- colunas novas) — é o comportamento esperado de desfazer a feature, não
-- uma perda acidental.
--
-- Também desfaz a reabertura de lembretes cancelados (Etapa D-TER, Opção
-- A) — volta ao gap conhecido da Fase D (reativar não traz o lembrete de
-- volta). Nenhuma linha de notification_jobs é tocada por este rollback em
-- si; só a função que fazia a reabertura deixa de existir.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';

DROP FUNCTION IF EXISTS public.reactivate_cancelled_appointment(uuid);
DROP FUNCTION IF EXISTS public.set_agenda_removed(uuid, boolean);

ALTER TABLE public.appointments
  DROP COLUMN IF EXISTS agenda_removed_at,
  DROP COLUMN IF EXISTS agenda_removed_by;

NOTIFY pgrst, 'reload schema';

COMMIT;
