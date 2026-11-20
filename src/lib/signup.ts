export const SIGNUP_STORAGE_KEY = "aura_signup_data";

// FASE AUTH-1 (20/11/2026) — marcador separado do rascunho acima: sinaliza
// que a usuária está NO MEIO do fluxo de cadastro (/auth?signup=true),
// pra sobreviver ao redirecionamento de página inteira que o OAuth
// (Apple/Google) faz — ver socialSignIn em src/routes/auth.tsx. Sem isso,
// `search.signup` (que só existe na URL) some quando o navegador volta de
// um provedor OAuth num redirect_uri sem querystring, e a tela perde o
// contexto "Continue seu cadastro" — ver FASE LEGAL-2F.
// Expira sozinho (30 min) pra nunca prender a usuária num estado de
// "cadastro em andamento" antigo se ela abandonar o fluxo e voltar dias
// depois por um link de login comum.
export const SIGNUP_MARKER_KEY = "aura_auth_signup";
const SIGNUP_MARKER_TTL_MS = 30 * 60 * 1000;

type SignupMarker = { active: true; expiresAt: number };

/** Grava o marcador. Nunca lança — se sessionStorage estiver indisponível
 * (modo privado, bloqueio do navegador), o app continua funcionando, só
 * sem a restauração automática de `signup=true` depois de um OAuth. */
export function markSignupInProgress(): void {
  try {
    const marker: SignupMarker = { active: true, expiresAt: Date.now() + SIGNUP_MARKER_TTL_MS };
    window.sessionStorage.setItem(SIGNUP_MARKER_KEY, JSON.stringify(marker));
  } catch {
    // sem storage — segue sem marcador.
  }
}

/** true se existe um marcador válido (ainda não expirado). Não apaga o
 * marcador — quem decide quando ele deixou de ser necessário é
 * clearSignupInProgress, chamada só quando o cadastro realmente termina. */
export function hasSignupInProgress(): boolean {
  try {
    const raw = window.sessionStorage.getItem(SIGNUP_MARKER_KEY);
    if (!raw) return false;
    const marker = JSON.parse(raw) as Partial<SignupMarker>;
    if (!marker.active || typeof marker.expiresAt !== "number") {
      window.sessionStorage.removeItem(SIGNUP_MARKER_KEY);
      return false;
    }
    if (marker.expiresAt < Date.now()) {
      window.sessionStorage.removeItem(SIGNUP_MARKER_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Limpa o marcador — chamar só quando o cadastro terminou (claim +
 * aplicação do rascunho concluídos) ou quando ele expirou sozinho
 * (hasSignupInProgress já cobre o caso de expiração). Nunca lança. */
export function clearSignupInProgress(): void {
  try {
    window.sessionStorage.removeItem(SIGNUP_MARKER_KEY);
  } catch {
    // sem storage — nada a limpar.
  }
}

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
  // Timestamp exato de quando o checkbox de aceite dos Termos/Política foi marcado
  // (etapa 2 do cadastro). Ausente enquanto não marcado.
  terms_accepted_at?: string;
};
