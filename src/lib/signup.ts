export const SIGNUP_STORAGE_KEY = "aura_signup_data";

export type PendingSignupData = {
  full_name: string;
  business_name: string;
  phone: string; // já normalizado em E.164
  profession: string;
  // Endereço é opcional — preenchido na etapa 2 do cadastro (/auth?signup=true).
  // Ausentes/undefined quando o usuário pula o bloco de endereço.
  cep?: string;
  city?: string;
  state?: string;
  address?: string;
};
