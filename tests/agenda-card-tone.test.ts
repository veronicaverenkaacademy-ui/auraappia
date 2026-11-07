// FASE C, COMMIT 2: cartão inteiro colorido por estado + cartões simultâneos
// lado a lado. Testa a tabela de precedência, contraste (WCAG), indicadores
// não-coloridos, faixas (lanes) e a ordem de pilha da Semana.
process.env.TZ = "America/Sao_Paulo";

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appointmentCardTone,
  resolveCardTone,
  clipToDayMinutes,
  assignLanes,
  weekCardStackStyle,
  type CardVariant,
} from "../src/lib/agenda-card-style.ts";

const VARIANTS: CardVariant[] = ["day", "week", "list", "detail"];

// ---------- Tabela de precedência (2a-2f) ----------

test("2a: cancelled + declined => cancelado pela cliente (vermelho, sem opacidade), em todas as variantes", () => {
  for (const v of VARIANTS) {
    const t = appointmentCardTone("cancelled", "declined", v);
    assert.equal(t.toneKey, "cancelled_by_client");
    assert.equal(t.bg, "bg-destructive/10");
    assert.ok(!t.bg.includes("opacity"), "cancelado pela cliente não deve reduzir opacidade/contraste");
    assert.equal(t.label, "Cancelado pela cliente");
    assert.equal(t.icon, "x");
  }
});

test("2b: cancelled + (pending|confirmed|reschedule_requested|null) => cancelado pela equipe, apagado como hoje", () => {
  for (const ccs of ["pending", "confirmed", "reschedule_requested", null, undefined] as const) {
    const t = appointmentCardTone("cancelled", ccs, "day");
    assert.equal(t.toneKey, "cancelled_by_team");
    assert.equal(t.bg, "bg-card opacity-60");
    assert.equal(t.label, "Cancelado");
    assert.equal(t.icon, null);
  }
});

test("2c: no_show, completed e bloqueio (fora do tom) continuam exatamente como hoje", () => {
  const noShow = appointmentCardTone("no_show", "pending", "day");
  assert.equal(noShow.bg, "bg-amber-50/60 dark:bg-amber-500/5");
  assert.equal(noShow.label, "Não compareceu");
  const completed = appointmentCardTone("completed", "confirmed", "day");
  assert.equal(completed.bg, "bg-card");
  assert.equal(completed.label, "Concluído");
});

test("2d: confirmed => verde, em todas as variantes", () => {
  for (const v of VARIANTS) {
    const t = appointmentCardTone("confirmed", "confirmed", v);
    assert.equal(t.toneKey, "confirmed");
    assert.equal(t.bg, "bg-success/10");
    assert.equal(t.label, "Confirmado");
    assert.equal(t.icon, "check");
  }
});

test("2e: pending, inclusive com reschedule_requested, => neutro como hoje (amarelo é da fase E)", () => {
  const a = appointmentCardTone("pending", "pending", "day");
  const b = appointmentCardTone("pending", "reschedule_requested", "day");
  assert.equal(a.toneKey, "pending");
  assert.equal(b.toneKey, "pending");
  assert.deepEqual(a, b, "reschedule_requested não muda o tom nesta fase");
  assert.equal(a.bg, "bg-card");
  assert.equal(a.icon, null);
});

test("2f: combinações incoerentes (confirmed+declined, pending+declined) seguem o status do agendamento, nunca escondem nada", () => {
  const confirmedDeclined = appointmentCardTone("confirmed", "declined", "day");
  assert.equal(confirmedDeclined.toneKey, "confirmed", "confirmed vence, client_confirmation_status incoerente é ignorado");
  const pendingDeclined = appointmentCardTone("pending", "declined", "day");
  assert.equal(pendingDeclined.toneKey, "pending");
});

test("resolveCardTone: função de precedência isolada cobre as 6 chaves possíveis", () => {
  assert.equal(resolveCardTone("pending", "pending"), "pending");
  assert.equal(resolveCardTone("confirmed", "confirmed"), "confirmed");
  assert.equal(resolveCardTone("completed", "confirmed"), "completed");
  assert.equal(resolveCardTone("no_show", "pending"), "no_show");
  assert.equal(resolveCardTone("cancelled", "declined"), "cancelled_by_client");
  assert.equal(resolveCardTone("cancelled", "pending"), "cancelled_by_team");
});

// ---------- Contraste (WCAG, cor final já com a mistura de opacidade) ----------
// Conversão OKLCH -> sRGB (CSS Color 4 / Björn Ottosson) feita só aqui, pra
// calcular o contraste real a partir dos tokens de src/styles.css — não é
// código de produção, só prova a escolha de opacidade (10%) deste PR.

function oklchToSrgb255(L: number, C: number, Hdeg: number): [number, number, number] {
  const h = (Hdeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(0, c), 1 / 2.4) - 0.055);
  return lin.map((c) => Math.round(Math.min(1, Math.max(0, toSrgb(c))) * 255)) as [number, number, number];
}
function relLum([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrastRatio(fg: [number, number, number], bg: [number, number, number]): number {
  const l1 = relLum(fg), l2 = relLum(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}
function mixOver(fg: [number, number, number], bg: [number, number, number], alpha: number): [number, number, number] {
  return [0, 1, 2].map((i) => Math.round(fg[i] * alpha + bg[i] * (1 - alpha))) as [number, number, number];
}

// Tokens de src/styles.css (light: linhas 79-95; dark: linhas 120-136).
const TOKENS = {
  light: {
    foreground: oklchToSrgb255(0.28, 0.015, 60),
    card: oklchToSrgb255(0.985, 0.006, 80),
    mutedForeground: oklchToSrgb255(0.5, 0.015, 60),
    destructive: oklchToSrgb255(0.55, 0.18, 25),
    success: oklchToSrgb255(0.62, 0.14, 150),
  },
  dark: {
    foreground: oklchToSrgb255(0.984, 0.003, 247.858),
    card: oklchToSrgb255(0.208, 0.042, 265.755),
    mutedForeground: oklchToSrgb255(0.704, 0.04, 256.788),
    destructive: oklchToSrgb255(0.704, 0.191, 22.216),
    success: oklchToSrgb255(0.65, 0.12, 150),
  },
};
const TINT_ALPHA = 0.1; // bg-success/10 e bg-destructive/10 usados nesta PR

for (const mode of ["light", "dark"] as const) {
  const t = TOKENS[mode];
  for (const [stateName, stateColor] of [["destructive", t.destructive], ["success", t.success]] as const) {
    const bg = mixOver(stateColor, t.card, TINT_ALPHA);
    test(`contraste ${mode}: texto principal (foreground) sobre bg-${stateName}/10 >= 4.5:1`, () => {
      const ratio = contrastRatio(t.foreground, bg);
      assert.ok(ratio >= 4.5, `contraste ${ratio.toFixed(2)}:1 abaixo do mínimo`);
    });
    test(`contraste ${mode}: texto secundário (muted-foreground) sobre bg-${stateName}/10 >= 4.5:1`, () => {
      const ratio = contrastRatio(t.mutedForeground, bg);
      assert.ok(ratio >= 4.5, `contraste ${ratio.toFixed(2)}:1 abaixo do mínimo`);
    });
  }
}

// ---------- Indicadores não-coloridos ----------

test("indicadores: confirmado e cancelado-pela-cliente são distinguíveis sem depender de cor (ícone + aria-label diferentes)", () => {
  const confirmed = appointmentCardTone("confirmed", "confirmed", "day");
  const cancelledClient = appointmentCardTone("cancelled", "declined", "day");
  const cancelledTeam = appointmentCardTone("cancelled", "pending", "day");
  assert.notEqual(confirmed.icon, cancelledClient.icon);
  assert.notEqual(confirmed.iconAriaLabel, cancelledClient.iconAriaLabel);
  assert.ok(confirmed.icon && confirmed.iconAriaLabel);
  assert.ok(cancelledClient.icon && cancelledClient.iconAriaLabel);
  // cancelado pela equipe não ganhou indicador novo nesta fase (mantido "como hoje")
  assert.equal(cancelledTeam.icon, null);
});

// ---------- Faixas (lanes) — visão Dia ----------

function day(y: number, m: number, d: number) { return new Date(y, m - 1, d); }
function iso(y: number, m: number, d: number, h: number, min: number) {
  return new Date(y, m - 1, d, h, min).toISOString();
}

test("clipToDayMinutes: agendamento totalmente dentro do dia", () => {
  const r = clipToDayMinutes(iso(2026, 11, 7, 11, 20), iso(2026, 11, 7, 12, 20), day(2026, 11, 7));
  assert.deepEqual(r, { startMin: 11 * 60 + 20, endMin: 12 * 60 + 20 });
});

test("clipToDayMinutes: agendamento que cruza a meia-noite é recortado em [0,1440) do dia exibido", () => {
  const r = clipToDayMinutes(iso(2026, 11, 7, 23, 0), iso(2026, 11, 8, 1, 0), day(2026, 11, 7));
  assert.deepEqual(r, { startMin: 23 * 60, endMin: 1440 });
  const rNextDay = clipToDayMinutes(iso(2026, 11, 7, 23, 0), iso(2026, 11, 8, 1, 0), day(2026, 11, 8));
  assert.deepEqual(rNextDay, { startMin: 0, endMin: 60 });
});

test("clipToDayMinutes: agendamento fora do dia exibido devolve null", () => {
  assert.equal(clipToDayMinutes(iso(2026, 11, 6, 10, 0), iso(2026, 11, 6, 11, 0), day(2026, 11, 7)), null);
});

test("assignLanes: 1 cartão sozinho => 1 faixa, nunca escondido", () => {
  const r = assignLanes([{ id: "a", startMin: 600, endMin: 660 }]);
  assert.deepEqual(r, [{ id: "a", lane: 0, totalLanes: 1, hidden: false, overflowCount: 0 }]);
});

test("assignLanes: consecutivos sem cruzar => cada um na própria faixa 0 (não precisam dividir espaço)", () => {
  const r = assignLanes([
    { id: "a", startMin: 600, endMin: 660 },
    { id: "b", startMin: 660, endMin: 720 },
  ]);
  const byId = new Map(r.map((x) => [x.id, x]));
  assert.equal(byId.get("a")!.lane, 0);
  assert.equal(byId.get("b")!.lane, 0);
  assert.equal(byId.get("a")!.totalLanes, 1);
});

test("assignLanes: três cruzados (11:20-12:20, 11:25-12:25, 11:35-12:35) => 3 faixas lado a lado, nenhum escondido", () => {
  const items = [
    { id: "a", startMin: 11 * 60 + 20, endMin: 12 * 60 + 20 },
    { id: "b", startMin: 11 * 60 + 25, endMin: 12 * 60 + 25 },
    { id: "c", startMin: 11 * 60 + 35, endMin: 12 * 60 + 35 },
  ];
  const r = assignLanes(items);
  assert.equal(r.length, 3);
  const lanes = new Set(r.map((x) => x.lane));
  assert.equal(lanes.size, 3, "3 faixas distintas");
  for (const x of r) {
    assert.equal(x.totalLanes, 3);
    assert.equal(x.hidden, false);
    assert.equal(x.overflowCount, 0);
  }
});

test("assignLanes: 4 simultâneos (mesmo intervalo) => 3 faixas visíveis, 1 escondido no '+1' do representante", () => {
  const items = [
    { id: "a", startMin: 600, endMin: 660 },
    { id: "b", startMin: 600, endMin: 660 },
    { id: "c", startMin: 600, endMin: 660 },
    { id: "d", startMin: 600, endMin: 660 },
  ];
  const r = assignLanes(items);
  const byId = new Map(r.map((x) => [x.id, x]));
  assert.equal(byId.get("a")!.totalLanes, 3);
  const hiddenCount = [...byId.values()].filter((x) => x.hidden).length;
  assert.equal(hiddenCount, 1, "exatamente 1 item escondido quando 4 cabem em 3 faixas");
  const representative = [...byId.values()].find((x) => x.overflowCount > 0);
  assert.ok(representative, "deve existir um representante com overflowCount > 0");
  assert.equal(representative!.overflowCount, 1, "mostra +1");
  assert.equal(representative!.lane, 2, "representante ocupa a última faixa visível (índice 2)");
});

test("assignLanes: mesmo minuto de início => ordem determinística por id (desempate estável)", () => {
  const items = [
    { id: "zzz", startMin: 600, endMin: 660 },
    { id: "aaa", startMin: 600, endMin: 660 },
  ];
  const r1 = assignLanes(items);
  const r2 = assignLanes([...items]); // mesma entrada, nova chamada
  assert.deepEqual(r1, r2, "determinístico entre chamadas");
  const byId = new Map(r1.map((x) => [x.id, x]));
  assert.equal(byId.get("aaa")!.lane, 0, "'aaa' < 'zzz' => fica na faixa 0");
  assert.equal(byId.get("zzz")!.lane, 1);
});

test("assignLanes: cruzando a meia-noite (itens já recortados por clipToDayMinutes) não geram faixa negativa", () => {
  const clipped = clipToDayMinutes(iso(2026, 11, 7, 23, 30), iso(2026, 11, 8, 0, 30), day(2026, 11, 7))!;
  const other = clipToDayMinutes(iso(2026, 11, 7, 23, 45), iso(2026, 11, 8, 0, 15), day(2026, 11, 7))!;
  const r = assignLanes([
    { id: "a", ...clipped },
    { id: "b", ...other },
  ]);
  assert.equal(r.length, 2);
  assert.ok(r.every((x) => x.lane >= 0), "nenhuma faixa negativa");
  const lanes = new Set(r.map((x) => x.lane));
  assert.equal(lanes.size, 2, "os dois se cruzam (23:30-00:30 vs 23:45-00:15) e ficam em faixas diferentes");
});

// ---------- Semana: ativos acima de cancelados ----------

test("weekCardStackStyle: ativo em primeiro plano (z-10, sem deslocamento)", () => {
  for (const status of ["pending", "confirmed", "completed", "no_show"] as const) {
    const s = weekCardStackStyle(status);
    assert.equal(s.z, "z-10");
    assert.equal(s.offset, "");
  }
});

test("weekCardStackStyle: cancelado atrás (z-0) com deslocamento sutil, ainda visível", () => {
  const s = weekCardStackStyle("cancelled");
  assert.equal(s.z, "z-0");
  assert.notEqual(s.offset, "", "precisa de algum deslocamento pra não ficar 100% escondido atrás do ativo");
});
