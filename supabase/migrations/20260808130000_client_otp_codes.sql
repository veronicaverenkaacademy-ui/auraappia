-- OTP customizado para login da cliente no Portal, enviado via WhatsApp por um
-- número único e centralizado da AURA (template "codigoaura", categoria
-- Authentication, aprovado pela Meta) — separado dos números individuais de
-- cada profissional, que continuam só para lembretes automáticos (Fase 3).
--
-- Chave de busca é só o telefone (sem owner_id): como o envio sai sempre do
-- mesmo número da AURA, independente de qual /l/:slug a cliente está
-- acessando, um código só pode existir por telefone por vez — não faz sentido
-- ter dois códigos simultâneos para o mesmo número em contextos diferentes.
-- Qual portal originou o pedido fica registrado em audit_log (observabilidade),
-- não nesta tabela (essa tabela só cuida de autenticar o telefone).
CREATE TABLE public.client_otp_codes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone        text NOT NULL,
  code_hash    text NOT NULL,
  expires_at   timestamptz NOT NULL,
  attempts     int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 5,
  used_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX client_otp_codes_phone_idx ON public.client_otp_codes (phone, created_at DESC);

-- Nenhuma policy para anon/authenticated: só service_role (que ignora RLS)
-- pode ler ou escrever aqui, sempre através das server functions dedicadas.
-- Nem a própria dona do salão tem motivo para ler o código de outra pessoa.
ALTER TABLE public.client_otp_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.client_otp_codes FROM anon, authenticated;
