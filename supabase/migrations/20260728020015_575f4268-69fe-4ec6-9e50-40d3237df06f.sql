
-- 1. Enum de papéis (extensível)
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'staff');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. user_roles
CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  granted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'admin');
$$;

CREATE POLICY user_roles_self_read ON public.user_roles
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY user_roles_admin_all ON public.user_roles
  FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- 3. team_members
CREATE TABLE IF NOT EXISTS public.team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  full_name text NOT NULL,
  phone text,
  email text,
  role_title text,
  profession text,
  avatar_url text,
  bio text,
  instagram text,
  agenda_color text DEFAULT '#5C3A2E',
  commission_type text NOT NULL DEFAULT 'percent',
  commission_value numeric NOT NULL DEFAULT 0,
  monthly_goal numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  booking_slug text UNIQUE,
  show_commission boolean NOT NULL DEFAULT false,
  onboarding_completed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_members TO authenticated;
GRANT ALL ON public.team_members TO service_role;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY team_members_owner_all ON public.team_members
  FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY team_members_self_read ON public.team_members
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY team_members_self_update ON public.team_members
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TRIGGER trg_team_members_updated_at BEFORE UPDATE ON public.team_members
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. team_permissions
CREATE TABLE IF NOT EXISTS public.team_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  member_id uuid NOT NULL REFERENCES public.team_members(id) ON DELETE CASCADE,
  resource text NOT NULL,
  action text NOT NULL,
  allowed boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, resource, action)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_permissions TO authenticated;
GRANT ALL ON public.team_permissions TO service_role;
ALTER TABLE public.team_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY team_perm_owner_all ON public.team_permissions
  FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY team_perm_self_read ON public.team_permissions
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.team_members m WHERE m.id = member_id AND m.user_id = auth.uid())
  );

-- 5. audit_log
CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  actor_id uuid,
  actor_name text,
  action text NOT NULL,
  resource text NOT NULL,
  resource_id text,
  details jsonb,
  ip text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_owner_read ON public.audit_log
  FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY audit_self_read ON public.audit_log
  FOR SELECT TO authenticated USING (actor_id = auth.uid());
CREATE POLICY audit_insert_authenticated ON public.audit_log
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

-- 6. Ao criar novo usuário direto (proprietário), conceder papel admin
CREATE OR REPLACE FUNCTION public.grant_admin_on_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Só concede admin se ainda não houver papel definido (ex.: já criado via createTeamMember)
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = NEW.id) THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin')
      ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS on_auth_user_grant_admin ON auth.users;
CREATE TRIGGER on_auth_user_grant_admin
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.grant_admin_on_new_user();

-- 7. Retro-conceder admin a usuários já existentes
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role FROM auth.users
ON CONFLICT DO NOTHING;
