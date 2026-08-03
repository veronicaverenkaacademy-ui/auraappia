-- grant_admin_on_new_user() concedia 'admin' a QUALQUER novo auth.users, sem distinguir
-- de onde veio o cadastro. Isso não era explorável ainda porque só existe cadastro de
-- profissional hoje, mas o futuro portal da cliente (telefone+OTP em /l/:slug) vai criar
-- auth.users pelo mesmo mecanismo (signInWithOtp) — e receberia admin por engano.
--
-- Agora só concede admin quando o auth.users nasce com metadata
-- user_type:'professional' (setado em src/routes/auth.tsx, só no fluxo /cadastro ->
-- /auth?signup=true). Sem esse metadata — inclusive o futuro cadastro de cliente —
-- nenhuma role é concedida; a conta fica sem role e o guard de _authenticated
-- (beforeLoad em src/routes/_authenticated/route.tsx) já bloqueia esse caso.
CREATE OR REPLACE FUNCTION public.grant_admin_on_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.raw_user_meta_data->>'user_type' = 'professional'
     AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = NEW.id) THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin')
      ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;
