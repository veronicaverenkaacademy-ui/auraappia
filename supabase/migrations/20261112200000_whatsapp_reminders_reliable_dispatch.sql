-- FASE LEMBRETES-1 (Pedido B) — disparo confiável dos lembretes de WhatsApp.
-- ESTE ARQUIVO AINDA NÃO FOI APLICADO EM PRODUÇÃO — só roda quando a dona
-- enviar a mensagem "AUTORIZO APLICAR MIGRAÇÃO FASE LEMBRETES-1". Criado
-- nesta branch (claude/lembretes-1-disparo-confiavel) só com leitura prévia
-- do banco (ver relatório da fase: pg_cron/pg_net confirmados disponíveis
-- mas NÃO instalados; nenhuma tabela/função abaixo existia antes).
--
-- ACHADO CENTRAL que motiva esta migration (mapa da fase, com evidência
-- real em produção, 12/11/2026): o único "agendador" que existe hoje é um
-- workflow do GitHub Actions (.github/workflows/whatsapp-cron.yml) com
-- `schedule: "*/5 * * * *"`, chamando /api/cron/whatsapp-reminders. Na
-- prática ele NÃO roda a cada 5 minutos — os últimos 100 disparos (24/10 a
-- 12/11) tiveram intervalo MEDIANO de 300 minutos (5h) entre execuções, 88%
-- deles com mais de 1h de buraco, pico de 634 minutos (~10h32). Isso é uma
-- limitação conhecida e documentada do GitHub Actions para o evento
-- `schedule` (atraso sob carga), não um bug deste projeto. Consequência
-- medida em notification_jobs: TODOS os 18 jobs de appointment_reminder_2h
-- já criados em produção terminaram 'cancelled' (ZERO 'sent') — a maioria
-- (13/18) por "Horário do agendamento já passou"/"atraso excedido"/
-- "nasceria atrasado demais" — ou seja, o lembrete de 2h nunca teve, na
-- prática, uma chance real de sair, porque a tolerância de atraso dele
-- (105min / MAX_LATE_2H_BEFORE_START_MS, ver central-reminder-policy.ts) é
-- muito menor que o buraco típico entre execuções do GitHub Actions. O
-- lembrete de 24h sobrevive melhor (9 enviados, graças à tolerância de 12h),
-- mas não está livre do mesmo problema.
--
-- Esta migration NÃO reescreve nada do pipeline de envio (continua 100%
-- em TypeScript, central-reminder-scheduler.server.ts e vizinhos, provado e
-- testado) — só prepara, no banco, as três peças que faltam pra tornar o
-- disparo confiável, nenhuma delas ligada por si só:
--   A) pg_cron + pg_net (disponíveis nesta instância, confirmados por
--      consulta a pg_available_extensions em 12/11/2026, mas nunca
--      instalados) — infraestrutura para um agendador que roda DENTRO do
--      próprio Postgres (sem depender da fila de runners do GitHub
--      Actions). O cron.schedule() que de fato liga isso fica em arquivo
--      SEPARADO (20261112210000_whatsapp_cron_schedule.sql), comentado.
--   B) whatsapp_blocked_recipients — bloqueio real de envio por telefone
--      (hoje looksLikeStopRequest só avisa a dona, nunca bloqueia de
--      verdade — ver central-webhook-handler.server.ts:389-402).
--   C) whatsapp_cron_runs — histórico mínimo de execuções (hoje só existe
--      como log efêmero do GitHub Actions; nenhuma tabela registra isso).
--   D) recover_stuck_notification_jobs() — nenhuma rotina hoje recupera um
--      job que ficou 'processing' pra sempre (processo anterior
--      travou/caiu no meio) — claim_notification_jobs só pega 'pending'.
--
-- Aditiva e retrocompatível: nenhuma tabela/coluna/função/política
-- existente é alterada ou removida. Idempotente (CREATE EXTENSION/TABLE/
-- INDEX IF NOT EXISTS, CREATE OR REPLACE FUNCTION) — seguro reaplicar.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';

-- ===================== SEÇÃO A — pg_cron / pg_net =====================
-- Confirmados disponíveis (pg_available_extensions, 12/11/2026):
-- pg_cron 1.6.4, pg_net 0.20.4. Instalar a extensão por si só NÃO cria
-- nenhum job nem chama nada — cron.job começa vazio; o cron.schedule() que
-- ligaria um disparo real está em arquivo separado, comentado, esperando
-- autorização própria. net.http_post (chamada HTTP de dentro do Postgres)
-- é o que o job agendado usaria para chamar o MESMO endpoint
-- /api/cron/whatsapp-reminders que o GitHub Actions já chama hoje — nenhuma
-- lógica de negócio nova em SQL, só um gatilho mais confiável para o
-- endpoint que já existe e já é testado.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ===================== SEÇÃO B — bloqueio real de PARAR/opt-out =====================
-- Hoje: looksLikeStopRequest (central-webhook-parser.ts) detecta "parar/sair/
-- stop/cancelar inscrição" na resposta da cliente, mas central-webhook-
-- handler.server.ts só grava um app_notifications avisando a dona — o
-- texto da própria notificação diz "o envio NÃO foi bloqueado
-- automaticamente". Esta tabela é o bloqueio de verdade: uma linha ATIVA
-- (unblocked_at IS NULL) para (owner_id, phone_e164) impede qualquer novo
-- envio de lembrete central para aquele telefone, naquele salão, até
-- alguém desbloquear manualmente (sem UI nesta fase — só a coluna
-- preparada; desbloquear ainda exige SQL direto, documentado no relatório).
-- Nunca bloqueia globalmente (um telefone pode ser cliente de mais de um
-- salão, ownerId distinto) nem apaga/altera nenhuma mensagem já enviada.
CREATE TABLE IF NOT EXISTS public.whatsapp_blocked_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Formato normalizePhoneBR (+55DDDNUMERO) — mesmo formato já usado em
  -- clients.phone/whatsapp_messages.recipient_phone. A comparação na hora
  -- de decidir se envia (central-reminder-policy.ts) ainda compara pelos
  -- últimos 8 dígitos, mesma técnica defensiva já usada para
  -- WHATSAPP_REMINDERS_TEST_PHONES — nunca depende do telefone bloqueado
  -- estar digitado byte a byte igual ao da cliente.
  phone_e164 text NOT NULL,
  blocked_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'client_stop_request'
    CHECK (source IN ('client_stop_request', 'manual')),
  reason text NOT NULL DEFAULT
    'Cliente respondeu pedindo para parar de receber mensagens pelo WhatsApp.',
  -- NULL = bloqueio ativo. Preenchido = foi desfeito (histórico nunca
  -- apagado) — reautorizar de novo cria uma NOVA linha ativa, nunca reusa
  -- esta (preserva o registro de quando/por que foi desbloqueada).
  unblocked_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Nunca duas linhas ATIVAS para o mesmo (owner_id, telefone) — a aplicação
-- só insere uma nova linha ativa depois de confirmar (pelo SELECT) que não
-- existe outra; esta unicidade é a rede de segurança contra corrida/retry.
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_blocked_recipients_active_idx
  ON public.whatsapp_blocked_recipients (owner_id, phone_e164)
  WHERE unblocked_at IS NULL;
CREATE INDEX IF NOT EXISTS whatsapp_blocked_recipients_owner_idx
  ON public.whatsapp_blocked_recipients (owner_id)
  WHERE unblocked_at IS NULL;

ALTER TABLE public.whatsapp_blocked_recipients ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_blocked_recipients FROM anon, authenticated;
GRANT ALL ON public.whatsapp_blocked_recipients TO service_role;

-- ===================== SEÇÃO C — histórico de execuções do cron =====================
-- Hoje a única "observabilidade" de uma execução é o log do GitHub Actions
-- (efêmero, só visível fora do produto) — nenhuma tabela registra que o
-- endpoint rodou, quando, e com que resultado agregado. Uma linha por
-- execução de handleWhatsappCronRequest; nenhuma coluna de telefone, nome
-- ou texto de mensagem — só contagens (mesmo padrão já seguro do JSON que
-- o endpoint devolve hoje) e a mensagem de erro, quando houver (sempre um
-- texto fixo interno — nunca o conteúdo de uma mensagem de cliente).
CREATE TABLE IF NOT EXISTS public.whatsapp_cron_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL,
  -- NULL = ainda rodando OU o processo caiu antes de terminar (um
  -- started_at antigo com finished_at ainda NULL é, em si, um sinal de
  -- alerta consultável — ver whatsapp_cron_runs_unfinished_idx).
  finished_at timestamptz NULL,
  ok boolean NULL,
  scan_enqueued int NULL,
  scan_recalculated int NULL,
  scan_cancelled_bobo int NULL,
  processed_claimed int NULL,
  processed_sent int NULL,
  processed_failed int NULL,
  processed_held int NULL,
  processed_cancelled int NULL,
  stuck_recovered int NULL,
  orphan_deleted int NULL,
  error_message text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_cron_runs_started_idx
  ON public.whatsapp_cron_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS whatsapp_cron_runs_unfinished_idx
  ON public.whatsapp_cron_runs (started_at)
  WHERE finished_at IS NULL;

ALTER TABLE public.whatsapp_cron_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_cron_runs FROM anon, authenticated;
GRANT ALL ON public.whatsapp_cron_runs TO service_role;

-- ===================== SEÇÃO D — recuperar job preso em 'processing' =====================
-- claim_notification_jobs (20260811090000_whatsapp_evolution_mvp.sql) só
-- reivindica status='pending' — se o processo que reivindicou um job
-- caiu/deu timeout DEPOIS de marcar 'processing' e ANTES de gravar o
-- resultado final, aquele job fica 'processing' para sempre, e
-- claim_notification_jobs nunca mais o escolhe. Escopo DELIBERADAMENTE
-- restrito aos dois tipos de lembrete central (appointment_reminder_24h/
-- 2h) — nunca appointment_confirmation/appointment_created/test, que
-- continuam exatamente como estão (fora do pedido desta fase).
--
-- Risco que esta função evita por desenho (nunca mandar a MESMA mensagem
-- duas vezes): antes de devolver um job preso para 'pending' (nova chance
-- de envio), confere se já existe um whatsapp_messages 'sent'/'delivered'/
-- 'read' para o MESMO agendamento+template — se existir, o envio real já
-- aconteceu (só a escrita em notification_jobs que travou) e o job é
-- RECONCILIADO como 'sent' (nunca reenviado). Se o único registro
-- encontrado for 'uncertain' (timeout da Meta, não se sabe se chegou), o
-- job fica como está (ainda 'processing') — mesma regra de "nunca reenviar
-- sozinho em caso de incerteza" já usada em sendCentralTemplate. Só quando
-- NENHUM envio for encontrado é que o job volta para 'pending' de verdade.
CREATE OR REPLACE FUNCTION public.recover_stuck_notification_jobs(
  p_stuck_after_minutes int DEFAULT 10,
  p_limit int DEFAULT 50
)
RETURNS TABLE(job_id uuid, appointment_id uuid, job_type text, outcome text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  rec RECORD;
  v_template_key text;
  v_sent_msg_id uuid;
  v_sent_at timestamptz;
  v_uncertain_msg_id uuid;
BEGIN
  FOR rec IN
    SELECT nj.id, nj.appointment_id, nj.type, nj.attempts
    FROM public.notification_jobs nj
    WHERE nj.status = 'processing'
      AND nj.type IN ('appointment_reminder_24h', 'appointment_reminder_2h')
      AND nj.updated_at < now() - (p_stuck_after_minutes || ' minutes')::interval
    ORDER BY nj.updated_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    v_template_key := CASE rec.type
      WHEN 'appointment_reminder_24h' THEN 'lembrete_24h'
      WHEN 'appointment_reminder_2h' THEN 'lembrete_2h'
    END;
    v_sent_msg_id := NULL;
    v_sent_at := NULL;
    v_uncertain_msg_id := NULL;

    IF rec.appointment_id IS NOT NULL THEN
      SELECT wm.id, wm.sent_at INTO v_sent_msg_id, v_sent_at
      FROM public.whatsapp_messages wm
      WHERE wm.appointment_id = rec.appointment_id
        AND wm.message_type = v_template_key
        AND wm.status IN ('sent', 'delivered', 'read')
      ORDER BY wm.created_at DESC
      LIMIT 1;
    END IF;

    IF v_sent_msg_id IS NOT NULL THEN
      UPDATE public.notification_jobs
      SET status = 'sent',
          sent_at = coalesce(v_sent_at, now()),
          last_error = 'Recuperado automaticamente: envio já confirmado em whatsapp_messages (a escrita em notification_jobs tinha travado em "processing").'
      WHERE id = rec.id;

      IF rec.type = 'appointment_reminder_24h' THEN
        UPDATE public.appointments
        SET reminder_24h_sent_at = coalesce(v_sent_at, now())
        WHERE id = rec.appointment_id AND reminder_24h_sent_at IS NULL;
      ELSE
        UPDATE public.appointments
        SET reminder_2h_sent_at = coalesce(v_sent_at, now())
        WHERE id = rec.appointment_id AND reminder_2h_sent_at IS NULL;
      END IF;

      job_id := rec.id; appointment_id := rec.appointment_id; job_type := rec.type; outcome := 'reconciled_sent';
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF rec.appointment_id IS NOT NULL THEN
      SELECT wm.id INTO v_uncertain_msg_id
      FROM public.whatsapp_messages wm
      WHERE wm.appointment_id = rec.appointment_id
        AND wm.message_type = v_template_key
        AND wm.status = 'uncertain'
      ORDER BY wm.created_at DESC
      LIMIT 1;
    END IF;

    IF v_uncertain_msg_id IS NOT NULL THEN
      -- Ainda incerto (timeout da Meta) — nunca reenviar sozinho; deixa
      -- 'processing' até o webhook de status resolver ou alguém decidir
      -- manualmente (mesma regra já usada no caminho normal de envio).
      job_id := rec.id; appointment_id := rec.appointment_id; job_type := rec.type; outcome := 'left_uncertain';
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- Nenhum envio encontrado: seguro liberar para nova tentativa. Não
    -- conta como uma tentativa real contra a Meta (mesma convenção já
    -- usada em hold_pending/defer — ver central-reminder-scheduler.server.ts).
    UPDATE public.notification_jobs
    SET status = 'pending',
        attempts = GREATEST(rec.attempts - 1, 0),
        last_error = 'Recuperado automaticamente: ficou "processando" por mais de ' || p_stuck_after_minutes || ' minuto(s) sem terminar (provável falha/timeout do processo anterior) — nenhum envio confirmado encontrado, liberado para nova tentativa.'
    WHERE id = rec.id;

    job_id := rec.id; appointment_id := rec.appointment_id; job_type := rec.type; outcome := 'reset_to_pending';
    RETURN NEXT;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.recover_stuck_notification_jobs(int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recover_stuck_notification_jobs(int, int) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
