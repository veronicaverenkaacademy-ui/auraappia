-- Agenda real: vínculo com profissional, bloqueios de horário e prevenção de conflito.
-- Isso é o que faltava para os triggers já existentes (consume_appointment_materials,
-- record_appointment_revenue) passarem a disparar de verdade.

-- 1. Vínculo com profissional (NULL = a própria dona atende) + flag de sobreposição
--    intencional (setada pelo app somente depois que a dona confirma "agendar mesmo assim").
ALTER TABLE public.appointments
  ADD COLUMN professional_id uuid REFERENCES public.team_members(id) ON DELETE SET NULL,
  ADD COLUMN force_overlap boolean NOT NULL DEFAULT false;

ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_ends_after_starts CHECK (ends_at > starts_at);

CREATE INDEX appointments_professional_idx ON public.appointments(owner_id, professional_id, starts_at);

-- 2. Bloqueios de horário (almoço, compromisso pessoal etc.) — tabela separada, para que
--    nunca disparem os triggers financeiros/estoque atrelados a appointments (que reagem a
--    status = 'completed' em qualquer linha daquela tabela). Segue o mesmo padrão de RLS
--    (owner_id = auth.uid()) das demais tabelas do projeto.
CREATE TABLE public.agenda_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  professional_id uuid REFERENCES public.team_members(id) ON DELETE SET NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  reason text,
  force_overlap boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agenda_blocks_ends_after_starts CHECK (ends_at > starts_at)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agenda_blocks TO authenticated;
GRANT ALL ON public.agenda_blocks TO service_role;
ALTER TABLE public.agenda_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY agenda_blocks_own_all ON public.agenda_blocks FOR ALL TO authenticated
  USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE INDEX agenda_blocks_professional_idx ON public.agenda_blocks(owner_id, professional_id, starts_at);

-- 3. Trava real contra dois agendamentos sobrepostos com o mesmo profissional (mesma conta).
--    NULL em professional_id é tratado como "a própria dona" via COALESCE. Cancelados nunca
--    conflitam. force_overlap = true é a única forma de furar essa trava — e só é gravada
--    depois que o app mostrou o aviso e a dona confirmou "agendar mesmo assim". Isso cobre
--    tanto o aviso no front quanto uma corrida (duas gravações simultâneas).
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_no_overlap
  EXCLUDE USING gist (
    owner_id WITH =,
    COALESCE(professional_id, '00000000-0000-0000-0000-000000000000'::uuid) WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  )
  WHERE (status <> 'cancelled'::public.appointment_status AND NOT force_overlap);

-- Observação: o cruzamento entre appointments e agenda_blocks (um bloqueio não pode ser
-- sobreposto por um agendamento e vice-versa) fica só na checagem do app (findConflicts em
-- src/lib/agenda.ts) — uma EXCLUDE constraint não cruza duas tabelas diferentes.
