ALTER TABLE public.appointments
  ADD COLUMN professional_id uuid REFERENCES public.team_members(id) ON DELETE SET NULL,
  ADD COLUMN force_overlap boolean NOT NULL DEFAULT false;

ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_ends_after_starts CHECK (ends_at > starts_at);

CREATE INDEX appointments_professional_idx ON public.appointments(owner_id, professional_id, starts_at);

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

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_no_overlap
  EXCLUDE USING gist (
    owner_id WITH =,
    COALESCE(professional_id, '00000000-0000-0000-0000-000000000000'::uuid) WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  )
  WHERE (status <> 'cancelled'::public.appointment_status AND NOT force_overlap);