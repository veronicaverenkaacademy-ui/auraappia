import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import type { Session } from "@supabase/supabase-js";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { isValidPhoneBR } from "@/lib/phone";
import { linkClientAccount } from "@/lib/clientPortal.functions";
import { requestClientOtp, verifyClientOtp } from "@/lib/otp/otp.functions";

export type MyClient = {
  id: string;
  owner_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  birthday: string | null;
  cpf: string | null;
};

export type ClientAuthView = "closed" | "phone" | "otp" | "signup" | "ready";

export type SignupFields = {
  full_name: string;
  email: string;
  birthday: string;
  cpf: string;
  how_found: string;
  accepted_terms: boolean;
};

const EMPTY_SIGNUP: SignupFields = {
  full_name: "",
  email: "",
  birthday: "",
  cpf: "",
  how_found: "",
  accepted_terms: false,
};

/**
 * Login por telefone (OTP) + cadastro da cliente, compartilhado entre ClientAccountPanel
 * ("Minha conta") e o funil de agendamento — a mesma lógica, um único lugar, para nunca
 * ter dois fluxos de autenticação de cliente divergindo com o tempo.
 */
export function useClientAuth(ownerId: string) {
  const [view, setView] = useState<ClientAuthView>("closed");
  const [session, setSession] = useState<Session | null>(null);
  const [myClient, setMyClient] = useState<MyClient | null>(null);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [signup, setSignup] = useState<SignupFields>(EMPTY_SIGNUP);

  const linkFn = useServerFn(linkClientAccount);
  const requestOtpFn = useServerFn(requestClientOtp);
  const verifyOtpFn = useServerFn(verifyClientOtp);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const resolveClient = async (fields?: SignupFields): Promise<boolean> => {
    setLoading(true);
    try {
      const res = await linkFn({
        data: {
          owner_id: ownerId,
          full_name: fields?.full_name,
          email: fields?.email,
          birthday: fields?.birthday,
          cpf: fields?.cpf,
          how_found: fields?.how_found,
          accepted_terms: fields?.accepted_terms,
        },
      });
      setMyClient(res.client);
      setView("ready");
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("Nome é obrigatório") || msg.includes("aceitar os Termos")) {
        setView("signup");
      } else {
        console.error("[useClientAuth] Falha ao vincular conta da cliente", e);
        toast.error(`Não foi possível continuar: ${msg}`);
      }
      return false;
    } finally {
      setLoading(false);
    }
  };

  const start = () => {
    if (session) {
      void resolveClient();
    } else {
      setView("phone");
    }
  };

  const sendCode = async () => {
    if (!isValidPhoneBR(phone)) {
      toast.error("Digite um telefone válido (com DDD)");
      return;
    }
    setLoading(true);
    try {
      await requestOtpFn({ data: { owner_id: ownerId, phone } });
      toast.success("Código enviado por WhatsApp");
      setView("otp");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível enviar o código.");
    } finally {
      setLoading(false);
    }
  };

  const verify = async (): Promise<boolean> => {
    if (code.length !== 6) return false;
    setLoading(true);
    try {
      const { access_token, refresh_token } = await verifyOtpFn({
        data: { owner_id: ownerId, phone, code },
      });
      const { error } = await supabase.auth.setSession({ access_token, refresh_token });
      if (error) throw error;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Código inválido");
      setLoading(false);
      return false;
    }
    setLoading(false);
    return resolveClient();
  };

  const confirmSignup = async (): Promise<boolean> => {
    if (signup.full_name.trim().length < 3) {
      toast.error("Digite seu nome completo");
      return false;
    }
    if (!signup.accepted_terms) {
      toast.error(
        "Você precisa aceitar os Termos de Uso e a Política de Privacidade para continuar.",
      );
      return false;
    }
    return resolveClient(signup);
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setMyClient(null);
    setView("closed");
    setSignup(EMPTY_SIGNUP);
  };

  return {
    view,
    setView,
    session,
    myClient,
    setMyClient,
    phone,
    setPhone,
    code,
    setCode,
    signup,
    setSignup,
    loading,
    start,
    sendCode,
    verify,
    confirmSignup,
    logout,
  };
}
