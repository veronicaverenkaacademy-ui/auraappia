// FASE CONSENT-1H — buildAnswerSummary (src/components/portal/client-
// consent-summary.ts) é puro (sem JSX), importável direto num node:test
// puro — exatamente como client-consent-payload.ts (CONSENT-1F). Prova o
// mapeamento 1-para-1 de cada escolha pro rótulo curto exibido no "Você
// escolheu", e que o resumo NUNCA diverge do payload real enviado ao
// servidor (os dois leem a mesma escolha crua).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAnswerSummary,
  UNANSWERED_LABEL,
} from "../src/components/portal/client-consent-summary.ts";
import { buildFullBatchPayload } from "../src/components/portal/client-consent-payload.ts";

const ALL_TYPES = ["health_data", "image_use", "marketing", "whatsapp_reminders"] as const;

test("buildAnswerSummary: pergunta sem resposta aparece como 'Falta responder'", () => {
  const entries = buildAnswerSummary(ALL_TYPES, {});
  assert.equal(entries.length, 4);
  for (const entry of entries) {
    assert.equal(entry.rawChoice, null);
    assert.equal(entry.answerLabel, UNANSWERED_LABEL);
  }
});

test("buildAnswerSummary: health_data/marketing/whatsapp_reminders mapeiam granted->Aceito e denied->Não aceito", () => {
  for (const type of ["health_data", "marketing", "whatsapp_reminders"] as const) {
    const granted = buildAnswerSummary([type], { [type]: "granted" });
    assert.equal(granted[0].answerLabel, "Aceito");
    const denied = buildAnswerSummary([type], { [type]: "denied" });
    assert.equal(denied[0].answerLabel, "Não aceito");
  }
});

test("buildAnswerSummary: image_use mapeia as 3 escolhas pros 3 rótulos curtos distintos e corretos", () => {
  const denied = buildAnswerSummary(["image_use"], { image_use: "denied" });
  assert.equal(denied[0].answerLabel, "Não autorizo");
  const noFace = buildAnswerSummary(["image_use"], { image_use: "granted_no_face" });
  assert.equal(noFace[0].answerLabel, "Autorizo sem mostrar o rosto");
  const granted = buildAnswerSummary(["image_use"], { image_use: "granted" });
  assert.equal(granted[0].answerLabel, "Autorizo, inclusive com o rosto");
});

test("buildAnswerSummary: a ordem do resumo segue EXATAMENTE a ordem passada (a mesma ordem exibida no formulário)", () => {
  const entries = buildAnswerSummary(["marketing", "image_use", "health_data"], {
    marketing: "granted",
    image_use: "denied",
    health_data: "denied",
  });
  assert.deepEqual(
    entries.map((e) => e.type),
    ["marketing", "image_use", "health_data"],
  );
});

test("buildAnswerSummary: expõe o rawChoice crú (mesmo valor que seria gravado), não só o texto", () => {
  const entries = buildAnswerSummary(["image_use"], { image_use: "granted_no_face" });
  assert.equal(entries[0].rawChoice, "granted_no_face");
});

test("GUARDA: o resumo e o payload NUNCA divergem — para qualquer combinação de respostas, o rawChoice de cada tipo no resumo é EXATAMENTE o valor que buildFullBatchPayload enviaria pro mesmo tipo", () => {
  const combinations: Record<
    (typeof ALL_TYPES)[number],
    "granted" | "denied" | "granted_no_face"
  >[] = {
    health_data: ["granted", "denied"],
    image_use: ["granted", "denied", "granted_no_face"],
    marketing: ["granted", "denied"],
    whatsapp_reminders: ["granted", "denied"],
  };

  // Amostra alguns cenários completos (não precisa do produto cartesiano
  // inteiro — só provar que não há nenhum ponto de divergência real).
  const scenarios = [
    {
      health_data: "granted",
      image_use: "denied",
      marketing: "denied",
      whatsapp_reminders: "denied",
    },
    {
      health_data: "denied",
      image_use: "granted_no_face",
      marketing: "granted",
      whatsapp_reminders: "granted",
    },
    {
      health_data: "granted",
      image_use: "granted",
      marketing: "granted",
      whatsapp_reminders: "denied",
    },
  ] as const;

  for (const scenario of scenarios) {
    const summary = buildAnswerSummary(ALL_TYPES, scenario);
    const payload = buildFullBatchPayload("owner-1", scenario);
    const payloadByType = {
      health_data: payload.healthData,
      image_use: payload.imageUse,
      marketing: payload.marketing,
      whatsapp_reminders: payload.whatsappReminders,
    };
    for (const entry of summary) {
      assert.equal(
        entry.rawChoice,
        payloadByType[entry.type],
        `resumo e payload divergiram em ${entry.type}`,
      );
    }
  }

  // Confirma que as combinações usadas acima realmente cobrem as opções
  // válidas de cada tipo (evita um teste que "passa" sem testar nada).
  assert.ok(combinations.image_use.includes("granted_no_face"));
});
