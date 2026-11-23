-- FASE OPS-1 (Parte B) — função de limpeza de códigos antigos de login do
-- portal da cliente (public.client_otp_codes). ESTE ARQUIVO AINDA NÃO FOI
-- APLICADO EM PRODUÇÃO — por instrução explícita da dona, só branch nova +
-- PR em DRAFT. Aplicação só com a frase exata
-- "AUTORIZO APLICAR MIGRAÇÃO FASE OPS-1".
--
-- POR QUE ESTA LIMPEZA EXISTE (LGPD): client_otp_codes.phone guarda o
-- telefone da cliente em texto puro (ver 20260808130000_client_otp_codes.sql
-- — NOT NULL, sem hash). Hoje nenhuma rotina apaga linhas antigas: o volume
-- só CRESCE pra sempre. Isso é dado pessoal retido sem prazo — exatamente o
-- tipo de coisa que a LGPD pede pra minimizar. Esta função reduz a retenção
-- pro mínimo que o próprio produto precisa (ver cálculo da janela abaixo),
-- sem mudar nenhum comportamento de login.
--
-- CÁLCULO DA JANELA DE RETENÇÃO (lido em código nesta fase, não suposto):
--   - otp-global-cap.ts: OTP_GLOBAL_HOURLY_CAP conta client_otp_codes desde
--     `now - 1h`; OTP_GLOBAL_DAILY_CAP conta desde `now - 24h`
--     (countGlobalOtpCodesSince) — ESTA é a maior janela de tempo que
--     qualquer regra deste arquivo consulta.
--   - otp.functions.ts: cooldown usa a linha mais recente por telefone
--     (60s); teto por telefone usa as últimas MAX_REQUESTS_PER_PHONE_IN_WINDOW
--     (5) linhas por telefone, filtradas a WINDOW_MS (15min) — nenhuma das
--     duas faz um WHERE created_at >= X na query (só ORDER BY + LIMIT), mas
--     o que IMPORTA pra decisão nunca passa de 15min, bem dentro de 24h.
--   - verify-client-otp.server.ts: lê só a linha MAIS RECENTE por telefone
--     (sem filtro de data) — também coberto com folga por 24h, já que um
--     código tem expires_at de 10min (OTP_TTL_MS) e a cliente verifica em
--     minutos, não em dias.
--   - A dona pediu "manter 24 horas". Como a maior janela real (o teto
--     DIÁRIO) é exatamente 24h, usar 24h cravado como retenção arriscaria
--     apagar, na borda exata, uma linha que uma contagem do teto diário
--     ainda precisa enxergar (corrida entre o cron de limpeza e uma
--     requisição de OTP acontecendo no mesmo instante, ou um `now()`
--     ligeiramente diferente entre os dois). Por isso: retenção = 48 HORAS
--     (24h da janela real + 24h de margem de segurança) — nunca apaga nada
--     que qualquer regra de negócio ainda possa precisar, e ainda assim
--     elimina a retenção indefinida que existia antes.
--
-- POR QUE SEM SECURITY DEFINER: diferente de outras funções desta família
-- (ex.: apply_whatsapp_central_reply, que PRECISA de SECURITY DEFINER porque
-- é chamada por uma rota que roda como anon/authenticated, sem privilégio
-- direto na tabela), esta função só pode ser chamada por service_role (ver
-- REVOKE/GRANT abaixo) — e service_role já tem DELETE direto em
-- client_otp_codes e ignora RLS (rolbypassrls=true, confirmado por consulta
-- a pg_roles nesta mesma fase). SECURITY DEFINER aqui não destravaria nada
-- que o chamador já não tivesse — só aumentaria a superfície sem motivo.
--
-- BATELADA LIMITADA + SKIP LOCKED: cada chamada apaga no máximo
-- p_batch_limit (padrão 5000) linhas, as mais ANTIGAS primeiro, com
-- `FOR UPDATE SKIP LOCKED` na seleção — se uma linha estiver sendo
-- verificada/reivindicada por um login em andamento (UPDATE concorrente em
-- verify-client-otp.server.ts), esta função simplesmente pula aquela linha
-- nesta chamada em vez de esperar o lock (nunca atrasa um login de
-- verdade). `set_config('lock_timeout', ...)` também limitado à transação
-- da própria chamada, como defesa extra. Com os tetos atuais (300/dia), o
-- volume realista de linhas com mais de 48h num dado momento é bem menor
-- que 5000 — na prática, uma única chamada deve sempre zerar o backlog;
-- o limite de bateleda é só uma salvaguarda, não uma necessidade do volume
-- de hoje.
--
-- IDEMPOTENTE: chamar de novo sem nada pra apagar devolve 0, sem erro.
-- Aditiva — não altera nenhuma coluna/tabela existente, só cria a função.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';

CREATE OR REPLACE FUNCTION public.cleanup_old_client_otp_codes(
  p_batch_limit integer DEFAULT 5000
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_retention_hours CONSTANT integer := 48;
  v_cutoff timestamptz := now() - (v_retention_hours || ' hours')::interval;
  v_deleted integer;
BEGIN
  IF p_batch_limit IS NULL OR p_batch_limit <= 0 THEN
    RAISE EXCEPTION 'p_batch_limit deve ser um inteiro positivo, recebido: %', p_batch_limit;
  END IF;

  -- Limitado só à transação desta chamada (SET LOCAL) — nunca muda o
  -- lock_timeout de nenhuma outra sessão/transação.
  PERFORM set_config('lock_timeout', '3s', true);

  WITH batch AS (
    SELECT id
    FROM public.client_otp_codes
    WHERE created_at < v_cutoff
    ORDER BY created_at ASC
    LIMIT p_batch_limit
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public.client_otp_codes
  WHERE id IN (SELECT id FROM batch);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION public.cleanup_old_client_otp_codes(integer) IS
  'FASE OPS-1: apaga em lotes (padrão 5000) as linhas de client_otp_codes '
  'com created_at mais antigo que 48h (maior janela real usada pelos tetos '
  'de OTP é 24h, ver cabeçalho da migração 20261123190000). Devolve a '
  'contagem de linhas apagadas nesta chamada. Chamar repetidamente até '
  'devolver 0 para esvaziar um backlog maior que o lote.';

REVOKE ALL ON FUNCTION public.cleanup_old_client_otp_codes(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_old_client_otp_codes(integer) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
