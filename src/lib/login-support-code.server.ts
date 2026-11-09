// Código de suporte por passo do login da cliente (item 1.1 da FASE G6.2-F) —
// sem isso, toda falha interna no login virava a mesma mensagem genérica,
// sem jeito de saber qual passo quebrou. Cada passo tem uma etiqueta curta,
// logada no servidor (sem telefone/código/token) e devolvida à cliente como
// uma referência curta e inofensiva ("Código de suporte: L03"), pra poder
// repassar ao suporte sem expor nada técnico. Só imports relativos — ver
// nota em verify-client-otp.server.ts sobre por quê.
export const LOGIN_STEP = {
  CLAIM: "L01",
  CLIENT_LOOKUP: "L02",
  AUTH_CREATE: "L03",
  AUTH_FIND_EXISTING: "L04",
  AUTH_UPDATE_PASSWORD: "L05",
  AUTH_SIGN_IN: "L06",
  CLIENT_LINK: "L07",
} as const;

export type LoginStepCode = (typeof LOGIN_STEP)[keyof typeof LOGIN_STEP];

/** Loga o passo e o erro real (sem PII) e devolve a mensagem com o código de
 * suporte anexado — nunca o texto técnico do erro em si. */
export function failWithSupportCode(
  genericMessage: string,
  step: LoginStepCode,
  error: unknown,
): never {
  console.error(`[login] falha no passo ${step}`, error);
  throw new Error(`${genericMessage} Código de suporte: ${step}.`);
}
