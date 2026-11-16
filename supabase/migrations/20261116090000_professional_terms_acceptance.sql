-- FASE CONSENT-1C (16/11/2026) — registro de DATA + VERSÃO do aceite dos
-- Termos de Uso / Política de Privacidade pela profissional (dona ou
-- colaboradora — ambas têm linha em public.profiles). Decisão da dona:
-- só data + versão, SEM IP, SEM dispositivo/user-agent (diferente de
-- client_consents, que guarda evidência completa para a CLIENTE — aqui o
-- par é profissional↔AURA, não precisa do mesmo nível de prova).
--
-- ESTA MIGRAÇÃO NÃO FOI APLICADA EM PRODUÇÃO NESTA FASE — só branch nova +
-- PR em DRAFT, por instrução explícita da dona.
--
-- terms_accepted_at JÁ EXISTE (migration 20260804120000) e continua tendo
-- o mesmo papel: timestamp do último aceite. Esta migração só ADICIONA
-- terms_accepted_version — sem ela, não dá pra saber SE o aceite que
-- terms_accepted_at registra ainda corresponde ao texto atual (ela podia
-- ter aceitado uma versão de agosto e nunca mais ter visto o texto novo
-- de novembro). Sem backfill: contas existentes (hoje só de teste, sem
-- usuárias reais) ficam com terms_accepted_version NULL — o app trata
-- NULL como "precisa aceitar" (ver src/lib/professional-terms-version.ts),
-- então elas simplesmente veem o bloqueio de aceite na próxima vez que
-- abrirem o app, nunca um valor inventado.
--
-- PROTEÇÃO ESCOLHIDA (menor risco, conforme o PASSO 0 mostrou): REVOKE de
-- coluna, não trigger. public.profiles usa só RLS por LINHA hoje (as 3
-- policies — insert/read/update — são todas "auth.uid() = id", sem
-- nenhuma distinção de COLUNA) — não existe nenhum padrão de trigger de
-- imutabilidade nesta tabela pra seguir, e um trigger novo só pra duas
-- colunas seria mais código e mais risco de interferir no UPDATE comum de
-- profiles (nome, avatar, endereço etc.) ou no INSERT do handle_new_user
-- (que roda SECURITY DEFINER, então nem seria afetado por um REVOKE em
-- authenticated/anon de qualquer forma — mas um trigger BEFORE UPDATE
-- POR LINHA precisaria reimplementar essa distinção na mão). REVOKE
-- UPDATE só nas DUAS colunas novas/sensíveis é a ferramenta nativa do
-- Postgres pra exatamente este caso ("a maioria das colunas continua
-- editável pelo dono da linha, duas não") — avaliado ANTES da RLS, sem
-- nenhuma outra coluna de profiles afetada, sem precisar de função nova.
-- A gravação de verdade passa a ser só por supabaseAdmin
-- (src/lib/professional-terms.functions.ts, acceptMyTerms), igual ao
-- padrão já usado em client_consents/account-deletion.
--
-- Hoje (antes desta migração) o app grava terms_accepted_at direto do
-- navegador (auth.tsx, applyPendingSignupData) — esse caminho é removido
-- no mesmo PR desta migração (a coluna sai do upsert client-side), então
-- o REVOKE abaixo não quebra nenhum fluxo que continue em produção depois
-- do merge.
--
-- Idempotente (ADD COLUMN IF NOT EXISTS). Aditiva: nenhuma coluna/policy
-- existente é alterada ou removida. Termina com NOTIFY pgrst.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS terms_accepted_version text NULL;

-- Proteção por coluna: authenticated/anon continuam podendo UPDATE
-- qualquer outra coluna da própria linha (RLS "Own profile update" segue
-- valendo igual pra todas elas) — só estas duas ficam de fora, pra
-- qualquer role que não seja service_role.
REVOKE UPDATE (terms_accepted_version, terms_accepted_at)
  ON public.profiles FROM authenticated, anon;

-- Explícito (redundante com o GRANT ALL padrão do Supabase pra
-- service_role, mas documenta a intenção — mesmo estilo das migrações
-- anteriores, ex. client_consents).
GRANT UPDATE (terms_accepted_version, terms_accepted_at)
  ON public.profiles TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
