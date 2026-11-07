// Estilo e posição dos cartões da Agenda (FASE C). TZ fixado igual aos
// outros arquivos de teste da Agenda (não é usado aqui diretamente, mas
// mantém a convenção caso algum dia um teste novo precise de Date local).
process.env.TZ = "America/Sao_Paulo";

import { test } from "node:test";
import assert from "node:assert/strict";
import { LEGACY_STATUS_STYLE, calcCardRect } from "../src/lib/agenda-card-style.ts";

// ---------- COMMIT 1: caracterização (comportamento ATUAL, sem mudança) ----------
// Os valores abaixo são cópia literal do objeto STATUS que existia em
// agenda.tsx antes deste refactor (lido diretamente do arquivo antes de
// qualquer edição) — provam que LEGACY_STATUS_STYLE não mudou nada.

test("LEGACY_STATUS_STYLE: cópia exata do STATUS que existia em agenda.tsx (nenhum valor mudou)", () => {
  assert.deepEqual(LEGACY_STATUS_STYLE, {
    pending: { label: "Agendado", dot: "bg-muted-foreground/60", ring: "border-border", bg: "bg-card", badge: "bg-secondary text-muted-foreground" },
    confirmed: { label: "Confirmado", dot: "bg-success", ring: "border-success/30", bg: "bg-card", badge: "bg-success/10 text-success" },
    completed: { label: "Concluído", dot: "bg-purple-500", ring: "border-purple-500/30", bg: "bg-card", badge: "bg-purple-500/10 text-purple-600 dark:text-purple-400" },
    cancelled: { label: "Cancelado", dot: "bg-destructive", ring: "border-destructive/30", bg: "bg-card opacity-60", badge: "bg-destructive/10 text-destructive" },
    no_show: { label: "Não compareceu", dot: "bg-amber-500", ring: "border-amber-500/30", bg: "bg-amber-50/60 dark:bg-amber-500/5", badge: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  });
});

// Referência: a fórmula que existia inline em cada view ANTES do refactor
// (ApptCard/BlockBar usavam esta forma; WeekView usava a mesma fórmula com
// seus próprios minHeight/bottomPad). Copiada aqui só para o teste provar
// equivalência — não é usada pelo código de produção.
function legacyRect(start: number, end: number, hourHeight: number, minHeight: number, bottomPad: number) {
  const top = (start - 0) * hourHeight + 2; // HOURS[0] sempre 0 na Agenda
  const height = Math.max(minHeight, (end - start) * hourHeight - bottomPad);
  return { top, height };
}

const HOUR_H = 64;
const RECT_CASES: Array<{ name: string; start: number; end: number; minHeight: number; bottomPad: number }> = [
  { name: "cartão normal (1h)", start: 9, end: 10, minHeight: 30, bottomPad: 6 },
  { name: "cartão curto (15min)", start: 14, end: 14.25, minHeight: 30, bottomPad: 6 },
  { name: "cartão longo (3h)", start: 8, end: 11, minHeight: 30, bottomPad: 6 },
  { name: "primeiro horário do dia (00:00)", start: 0, end: 1, minHeight: 30, bottomPad: 6 },
  { name: "último horário do dia (23:00-23:59)", start: 23, end: 23.9833, minHeight: 30, bottomPad: 6 },
  { name: "cruza a meia-noite (hourOf não é data-aware: end < start, cai no mínimo)", start: 23, end: 0.5, minHeight: 30, bottomPad: 6 },
  { name: "bloqueio (BlockBar: minHeight 26)", start: 12, end: 12.5, minHeight: 26, bottomPad: 6 },
  { name: "cartão da Semana (minHeight 24, bottomPad 4)", start: 9, end: 10, minHeight: 24, bottomPad: 4 },
];

for (const c of RECT_CASES) {
  test(`calcCardRect: ${c.name} — idêntico à fórmula antiga`, () => {
    const got = calcCardRect(c.start, c.end, { hourHeight: HOUR_H, minHeight: c.minHeight, bottomPad: c.bottomPad });
    const want = legacyRect(c.start, c.end, HOUR_H, c.minHeight, c.bottomPad);
    assert.deepEqual(got, want);
  });
}

test("calcCardRect: várias combinações aleatórias (determinísticas) continuam iguais à fórmula antiga", () => {
  const starts = [0, 1.5, 6, 9.25, 12, 13.75, 18, 20.5, 22];
  for (const start of starts) {
    for (const durationH of [0.25, 0.5, 1, 1.5, 2, 4]) {
      const end = start + durationH;
      const got = calcCardRect(start, end, { hourHeight: HOUR_H, minHeight: 30, bottomPad: 6 });
      const want = legacyRect(start, end, HOUR_H, 30, 6);
      assert.deepEqual(got, want, `start=${start} end=${end}`);
    }
  }
});

test("várias sem cruzar (3 cartões em sequência): cada um mantém sua própria posição, sem interferência", () => {
  const a = calcCardRect(9, 10, { hourHeight: HOUR_H, minHeight: 30, bottomPad: 6 });
  const b = calcCardRect(10, 11, { hourHeight: HOUR_H, minHeight: 30, bottomPad: 6 });
  const c = calcCardRect(11, 12.5, { hourHeight: HOUR_H, minHeight: 30, bottomPad: 6 });
  assert.equal(a.top, 9 * HOUR_H + 2);
  assert.equal(b.top, 10 * HOUR_H + 2);
  assert.equal(c.top, 11 * HOUR_H + 2);
  assert.ok(a.top + a.height <= b.top + 2, "cartão 1 termina antes do 2 começar visualmente (tolerância do padding)");
});
