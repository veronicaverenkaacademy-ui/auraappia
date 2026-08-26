-- Níveis de acesso nomeados (Recepcionista/Profissional/Gerente), substituindo o papel
-- "staff" genérico por 3 papéis com permissões próprias, editáveis pela dona por conta.
-- team_permissions (já existente) passa a funcionar como exceção individual por cima do
-- padrão do nível — não muda de formato, só de papel semântico.

-- 1. access_levels: um conjunto de níveis por conta (owner_id).
CREATE TABLE public.access_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.access_levels TO authenticated;
GRANT ALL ON public.access_levels TO service_role;
ALTER TABLE public.access_levels ENABLE ROW LEVEL SECURITY;

CREATE POLICY access_levels_owner_all ON public.access_levels
  FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY access_levels_team_read ON public.access_levels
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.team_members m
      WHERE m.owner_id = access_levels.owner_id AND m.user_id = auth.uid()
    )
  );

CREATE TRIGGER trg_access_levels_updated_at BEFORE UPDATE ON public.access_levels
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. access_level_permissions: o que cada nível concede, mesmo formato de team_permissions.
CREATE TABLE public.access_level_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  access_level_id uuid NOT NULL REFERENCES public.access_levels(id) ON DELETE CASCADE,
  resource text NOT NULL,
  action text NOT NULL,
  allowed boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (access_level_id, resource, action)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.access_level_permissions TO authenticated;
GRANT ALL ON public.access_level_permissions TO service_role;
ALTER TABLE public.access_level_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY access_level_permissions_owner_all ON public.access_level_permissions
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.access_levels l WHERE l.id = access_level_id AND l.owner_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.access_levels l WHERE l.id = access_level_id AND l.owner_id = auth.uid())
  );
CREATE POLICY access_level_permissions_team_read ON public.access_level_permissions
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.access_levels l
      JOIN public.team_members m ON m.owner_id = l.owner_id
      WHERE l.id = access_level_id AND m.user_id = auth.uid()
    )
  );

CREATE TRIGGER trg_access_level_permissions_updated_at BEFORE UPDATE ON public.access_level_permissions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. team_members ganha o vínculo com o nível. ON DELETE RESTRICT: o próprio banco recusa
--    apagar um nível enquanto alguém ainda estiver vinculado a ele (decisão 3a — bloquear,
--    não redistribuir automaticamente).
ALTER TABLE public.team_members
  ADD COLUMN access_level_id uuid REFERENCES public.access_levels(id) ON DELETE RESTRICT;

-- 4. Função reutilizável: cria os 3 níveis padrão + permissões default para uma conta.
--    Idempotente (ON CONFLICT DO NOTHING) — chamar de novo para quem já tem níveis não
--    duplica nem sobrescreve nada.
CREATE OR REPLACE FUNCTION public.seed_default_access_levels(_owner_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_resources text[] := ARRAY['agenda','clients','services','finance','marketing','stock','bi','settings','team','whatsapp','aura_ia'];
  v_actions text[] := ARRAY['view','create','edit','delete','export','share'];
  v_recepcionista_id uuid;
  v_profissional_id uuid;
  v_gerente_id uuid;
BEGIN
  INSERT INTO public.access_levels (owner_id, name, sort_order) VALUES (_owner_id, 'Recepcionista', 1)
    ON CONFLICT (owner_id, name) DO NOTHING;
  INSERT INTO public.access_levels (owner_id, name, sort_order) VALUES (_owner_id, 'Profissional', 2)
    ON CONFLICT (owner_id, name) DO NOTHING;
  INSERT INTO public.access_levels (owner_id, name, sort_order) VALUES (_owner_id, 'Gerente', 3)
    ON CONFLICT (owner_id, name) DO NOTHING;

  SELECT id INTO v_recepcionista_id FROM public.access_levels WHERE owner_id = _owner_id AND name = 'Recepcionista';
  SELECT id INTO v_profissional_id FROM public.access_levels WHERE owner_id = _owner_id AND name = 'Profissional';
  SELECT id INTO v_gerente_id FROM public.access_levels WHERE owner_id = _owner_id AND name = 'Gerente';

  -- Baseline: tudo negado para os 3 níveis, depois liberamos só o combinado.
  INSERT INTO public.access_level_permissions (access_level_id, resource, action, allowed)
  SELECT lvl, res, act, false
  FROM (VALUES (v_recepcionista_id), (v_profissional_id), (v_gerente_id)) AS levels(lvl)
  CROSS JOIN unnest(v_resources) AS res
  CROSS JOIN unnest(v_actions) AS act
  ON CONFLICT (access_level_id, resource, action) DO NOTHING;

  -- Recepcionista: agendar/cancelar horários, ver/cadastrar clientes, ver serviços,
  -- enviar lembretes via WhatsApp.
  UPDATE public.access_level_permissions SET allowed = true WHERE access_level_id = v_recepcionista_id
    AND (resource, action) IN (
      ('agenda','view'), ('agenda','create'), ('agenda','edit'), ('agenda','share'),
      ('clients','view'), ('clients','create'), ('clients','edit'),
      ('services','view'),
      ('whatsapp','view'), ('whatsapp','create')
    );

  -- Profissional: tudo do Recepcionista + ver financeiro (filtro por linha vem depois,
  -- na RLS de finance_transactions — aqui só libera a permissão de recurso).
  UPDATE public.access_level_permissions SET allowed = true WHERE access_level_id = v_profissional_id
    AND (resource, action) IN (
      ('agenda','view'), ('agenda','create'), ('agenda','edit'), ('agenda','share'),
      ('clients','view'), ('clients','create'), ('clients','edit'),
      ('services','view'),
      ('whatsapp','view'), ('whatsapp','create'),
      ('finance','view')
    );

  -- Gerente: acesso total (equivalente à dona nos dados; nunca no eixo de conta/exclusão,
  -- isso continua vindo de user_roles.role).
  UPDATE public.access_level_permissions SET allowed = true WHERE access_level_id = v_gerente_id;
END;
$$;

-- SECURITY DEFINER com efeito de escrita: nunca deixar chamável direto via API por
-- authenticated/anon, mesmo padrão já usado em record_appointment_revenue/
-- consume_appointment_materials — só o gatilho e esta migração devem executá-la.
REVOKE ALL ON FUNCTION public.seed_default_access_levels(uuid) FROM PUBLIC, anon, authenticated;

-- 5. Gatilho: toda conta nova que ganha o papel admin já nasce com os 3 níveis prontos.
CREATE OR REPLACE FUNCTION public.seed_access_levels_on_new_admin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.role = 'admin' THEN
    PERFORM public.seed_default_access_levels(NEW.user_id);
  END IF;
  RETURN NEW;
END; $$;

REVOKE ALL ON FUNCTION public.seed_access_levels_on_new_admin() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_user_roles_seed_access_levels ON public.user_roles;
CREATE TRIGGER on_user_roles_seed_access_levels
  AFTER INSERT ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.seed_access_levels_on_new_admin();

-- 6. Backfill: toda conta-dona que já existe hoje (inclusive a da dona deste projeto)
--    recebe os 3 níveis agora, de uma vez só, nesta migração.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT DISTINCT user_id FROM public.user_roles WHERE role = 'admin' LOOP
    PERFORM public.seed_default_access_levels(r.user_id);
  END LOOP;
END $$;
