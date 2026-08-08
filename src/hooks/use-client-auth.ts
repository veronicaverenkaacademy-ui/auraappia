import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import type { Session } from "@supabase/supabase-js";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { normalizePhoneBR, isValidPhoneBR } from "@/lib/phone";
import { linkClientAccount } from "@/lib/clientPortal.functions";

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

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const resolveClient = async (fields?: SignupFields, silent = false): Promise<boolean> => {
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
      } else if (silent) {
        // Havia uma sessão Supabase no navegador (ex.: a própria profissional logada no
        // painel, testando o Portal no mesmo navegador — o cliente Supabase é
        // compartilhado entre /_authenticated e /l/:slug), mas ela não resolveu como
        // cliente válida desta empresa. Isso não é um erro para mostrar — cai para o
        // login por telefone normal, como se não houvesse sessão nenhuma.
        console.warn(
          "[useClientAuth] Sessão existente não é uma cliente válida desta empresa; caindo para login por telefone",
          e,
        );
        setView("phone");
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
      void resolveClient(undefined, true);
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
    const { error } = await supabase.auth.signInWithOtp({ phone: normalizePhoneBR(phone) });
    setLoading(false);
    if (error) {
      toast.error(
        error.message.includes("provider")
          ? "Envio de SMS ainda não configurado por essa empresa. Avise a profissional."
          : error.message,
      );
      return;
    }
    toast.success("Código enviado por SMS");
    setView("otp");
  };

  const verify = async (): Promise<boolean> => {
    if (code.length !== 6) return false;
    setLoading(true);
    const { error } = await supabase.auth.verifyOtp({
      phone: normalizePhoneBR(phone),
      token: code,
      type: "sms",
    });
    setLoading(false);
    if (error) {
      toast.error("Código inválido");
      return false;
    }
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
