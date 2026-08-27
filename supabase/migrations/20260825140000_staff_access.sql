-- Etapa 2: acesso amplo de qualquer nível (Recepcionista/Profissional/Gerente) a
-- Agenda/Clientes/Serviços, conforme staff_can() resolver a partir de
-- access_level_permissions (ou team_permissions, como exceção individual).
-- Sem distinção por linha dentro do recurso (decisão desta rodada: Profissional tem o
-- mesmo escopo de visualização que Recepcionista para agenda/clientes). O filtro de
-- financeiro por profissional fica para uma etapa futura separada — ver nota no
-- .lovable/plan.md.

-- =====================================================================================
-- SEÇÃO A — função auxiliar usada dentro das políticas de RLS
-- =====================================================================================

-- Resolve team_permissions (exceção individual) -> access_level_permissions (padrão do
-- nível) -> nega. Chamada de dentro de USING/WITH CHECK, então PRECISA continuar
-- executável por "authenticated" (sem REVOKE) — mesmo padrão de is_admin()/has_role().
CREATE OR REPLACE FUNCTION public.staff_can(_owner_id uuid, _resource text, _action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (
      SELECT tp.allowed
      FROM public.team_permissions tp
      JOIN public.team_members tm ON tm.id = tp.member_id
      WHERE tm.owner_id = _owner_id
        AND tm.user_id = auth.uid()
        AND tm.status = 'active'
        AND tp.resource = _resource
        AND tp.action = _action
      LIMIT 1
    ),
    (
      SELECT alp.allowed
      FROM public.access_level_permissions alp
      JOIN public.team_members tm ON tm.access_level_id = alp.access_level_id
      WHERE tm.owner_id = _owner_id
        AND tm.user_id = auth.uid()
        AND tm.status = 'active'
        AND alp.resource = _resource
        AND alp.action = _action
      LIMIT 1
    ),
    false
  );
$$;

-- =====================================================================================
-- SEÇÃO B — políticas novas (aditivas — nenhuma política existente da dona é tocada)
-- =====================================================================================

-- appointments (resource "agenda")
CREATE POLICY appointments_staff_select ON public.appointments FOR SELECT TO authenticated
  USING (staff_can(owner_id, 'agenda', 'view'));
CREATE POLICY appointments_staff_insert ON public.appointments FOR INSERT TO authenticated
  WITH CHECK (staff_can(owner_id, 'agenda', 'create'));
CREATE POLICY appointments_staff_update ON public.appointments FOR UPDATE TO authenticated
  USING (staff_can(owner_id, 'agenda', 'edit'))
  WITH CHECK (staff_can(owner_id, 'agenda', 'edit'));

-- agenda_blocks (mesmo resource "agenda")
CREATE POLICY agenda_blocks_staff_select ON public.agenda_blocks FOR SELECT TO authenticated
  USING (staff_can(owner_id, 'agenda', 'view'));
CREATE POLICY agenda_blocks_staff_insert ON public.agenda_blocks FOR INSERT TO authenticated
  WITH CHECK (staff_can(owner_id, 'agenda', 'create'));
CREATE POLICY agenda_blocks_staff_update ON public.agenda_blocks FOR UPDATE TO authenticated
  USING (staff_can(owner_id, 'agenda', 'edit'))
  WITH CHECK (staff_can(owner_id, 'agenda', 'edit'));

-- appointment_materials (mapeado a "agenda"/edit — sem DELETE; ver nota sobre
-- materialsOverride: quem ajusta manualmente quantidade de produto ao finalizar
-- continua exigindo DELETE nesta tabela, que staff não tem — segue sem essa
-- capacidade específica por enquanto, finalizar com a ficha técnica padrão funciona
-- normalmente via gatilho, sem precisar de nenhuma permissão aqui)
CREATE POLICY appointment_materials_staff_select ON public.appointment_materials FOR SELECT TO authenticated
  USING (staff_can(owner_id, 'agenda', 'view'));
CREATE POLICY appointment_materials_staff_insert ON public.appointment_materials FOR INSERT TO authenticated
  WITH CHECK (staff_can(owner_id, 'agenda', 'edit'));
CREATE POLICY appointment_materials_staff_update ON public.appointment_materials FOR UPDATE TO authenticated
  USING (staff_can(owner_id, 'agenda', 'edit'))
  WITH CHECK (staff_can(owner_id, 'agenda', 'edit'));

-- clients (resource "clients")
CREATE POLICY clients_staff_select ON public.clients FOR SELECT TO authenticated
  USING (staff_can(owner_id, 'clients', 'view'));
CREATE POLICY clients_staff_insert ON public.clients FOR INSERT TO authenticated
  WITH CHECK (staff_can(owner_id, 'clients', 'create'));
CREATE POLICY clients_staff_update ON public.clients FOR UPDATE TO authenticated
  USING (staff_can(owner_id, 'clients', 'edit'))
  WITH CHECK (staff_can(owner_id, 'clients', 'edit'));

-- client_anamnesis (mesmo resource "clients")
CREATE POLICY client_anamnesis_staff_select ON public.client_anamnesis FOR SELECT TO authenticated
  USING (staff_can(owner_id, 'clients', 'view'));
CREATE POLICY client_anamnesis_staff_insert ON public.client_anamnesis FOR INSERT TO authenticated
  WITH CHECK (staff_can(owner_id, 'clients', 'edit'));
CREATE POLICY client_anamnesis_staff_update ON public.client_anamnesis FOR UPDATE TO authenticated
  USING (staff_can(owner_id, 'clients', 'edit'))
  WITH CHECK (staff_can(owner_id, 'clients', 'edit'));

-- client_photos (mesmo resource "clients")
CREATE POLICY client_photos_staff_select ON public.client_photos FOR SELECT TO authenticated
  USING (staff_can(owner_id, 'clients', 'view'));
CREATE POLICY client_photos_staff_insert ON public.client_photos FOR INSERT TO authenticated
  WITH CHECK (staff_can(owner_id, 'clients', 'edit'));
CREATE POLICY client_photos_staff_update ON public.client_photos FOR UPDATE TO authenticated
  USING (staff_can(owner_id, 'clients', 'edit'))
  WITH CHECK (staff_can(owner_id, 'clients', 'edit'));

-- services: só leitura, igual para os 3 níveis
CREATE POLICY services_staff_select ON public.services FOR SELECT TO authenticated
  USING (staff_can(owner_id, 'services', 'view'));

-- bucket "client-photos" (storage.objects) — mesmo escopo de client_photos acima.
-- Caminho dos objetos é {owner_id}/..., por isso o cast do primeiro segmento pra uuid.
CREATE POLICY client_photos_bucket_staff_select ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'client-photos'
    AND staff_can((storage.foldername(name))[1]::uuid, 'clients', 'view')
  );
CREATE POLICY client_photos_bucket_staff_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'client-photos'
    AND staff_can((storage.foldername(name))[1]::uuid, 'clients', 'edit')
  );
