// Núcleo puro (sem imports de alias) do indicador de 3 passos da tela de
// agendar (FASE K2b) — só agrupa os estados internos JÁ existentes do fluxo
// (booking-flow.tsx) em 3 passos visuais; não cria nem muda nenhum estado,
// nem toca na lógica de navegação real.

export type BookingUiStep = "service" | "professional" | "slot" | "auth" | "confirm" | "done";
export type DisplayStepNumber = 1 | 2 | 3;

export const DISPLAY_STEPS: ReadonlyArray<{
  number: DisplayStepNumber;
  label: string;
  caption: string;
}> = [
  { number: 1, label: "Serviço", caption: "Escolha o procedimento" },
  { number: 2, label: "Agenda", caption: "Defina a data e horário" },
  { number: 3, label: "Confirmação", caption: "Revise e conclua" },
];

/** service→1; professional+slot→2; auth+confirm+done→3 — "done" continua
 * marcado como passo 3 (não existe passo 4 na referência; a tela de
 * confirmação final É o passo 3 já concluído). */
export function displayStepFor(step: BookingUiStep): DisplayStepNumber {
  switch (step) {
    case "service":
      return 1;
    case "professional":
    case "slot":
      return 2;
    case "auth":
    case "confirm":
    case "done":
      return 3;
  }
}
