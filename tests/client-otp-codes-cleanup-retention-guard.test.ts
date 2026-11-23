// FASE OPS-1 (Parte B) — guarda estática: a retenção usada pela limpeza de
// client_otp_codes (migração 20261123190000, ainda NÃO aplicada em
// produção) nunca pode ficar menor que a MAIOR janela de tempo que
// qualquer regra de rate-limit de OTP lê de client_otp_codes — hoje essa
// janela é o teto DIÁRIO (OTP_GLOBAL_DAILY_CAP, 24h, em otp-global-cap.ts).
// Em vez de duplicar o número "24" aqui como constante solta, este teste
// EXTRAI os dois valores direto do código-fonte real (migração +
// otp-global-cap.ts) por regex — se um dia alguém aumentar a janela do
// teto diário sem atualizar a retenção da limpeza, este teste quebra.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migrationSrc = readFileSync(
  new URL("../supabase/migrations/20261123190000_client_otp_codes_cleanup.sql", import.meta.url),
  "utf8",
);
const capSrc = readFileSync(new URL("../src/lib/otp/otp-global-cap.ts", import.meta.url), "utf8");
const otpFunctionsSrc = readFileSync(
  new URL("../src/lib/otp/otp.functions.ts", import.meta.url),
  "utf8",
);

function extractRetentionHours(sql: string): number {
  const m = sql.match(/v_retention_hours\s+CONSTANT\s+integer\s*:=\s*(\d+)/);
  if (!m)
    throw new Error("v_retention_hours não encontrado na migração — teste não pode validar nada");
  return Number(m[1]);
}

function extractHourMs(src: string): number {
  // `const HOUR_MS = 60 * 60 * 1000;`
  const m = src.match(/HOUR_MS\s*=\s*(\d+)\s*\*\s*(\d+)\s*\*\s*(\d+)/);
  if (!m) throw new Error("HOUR_MS não encontrado em otp-global-cap.ts");
  return Number(m[1]) * Number(m[2]) * Number(m[3]);
}

function extractDayMsMultiplier(src: string): number {
  // `const DAY_MS = 24 * HOUR_MS;` — o multiplicador (24) é o que importa.
  const m = src.match(/DAY_MS\s*=\s*(\d+)\s*\*\s*HOUR_MS/);
  if (!m) throw new Error("DAY_MS (em função de HOUR_MS) não encontrado em otp-global-cap.ts");
  return Number(m[1]);
}

test("GUARDA: retenção da limpeza (horas) é extraível e é um número positivo", () => {
  const retentionHours = extractRetentionHours(migrationSrc);
  assert.ok(retentionHours > 0);
});

test("GUARDA: retenção (48h) nunca é menor que a janela do teto DIÁRIO de OTP (24h) — a maior janela real lida de client_otp_codes", () => {
  const retentionHours = extractRetentionHours(migrationSrc);
  const hourMs = extractHourMs(capSrc);
  const dayMultiplier = extractDayMsMultiplier(capSrc);
  const dailyWindowHours = (dayMultiplier * hourMs) / hourMs; // = dayMultiplier, mas calculado a partir do próprio código-fonte, não hardcoded
  assert.equal(dailyWindowHours, 24, "sanity check: a janela diária lida do código é 24h");
  assert.ok(
    retentionHours >= dailyWindowHours,
    `retenção (${retentionHours}h) precisa ser >= janela do teto diário (${dailyWindowHours}h)`,
  );
});

test("GUARDA: retenção também cobre com folga as janelas menores (por telefone/IP, 15min; cooldown, 60s) lidas de client_otp_codes em otp.functions.ts", () => {
  const retentionHours = extractRetentionHours(migrationSrc);
  const windowMsMatch = otpFunctionsSrc.match(/WINDOW_MS\s*=\s*(\d+)\s*\*\s*(\d+)\s*\*\s*(\d+)/);
  const cooldownMsMatch = otpFunctionsSrc.match(/COOLDOWN_MS\s*=\s*(\d+)\s*\*\s*(\d+)/);
  assert.ok(windowMsMatch, "WINDOW_MS não encontrado em otp.functions.ts");
  assert.ok(cooldownMsMatch, "COOLDOWN_MS não encontrado em otp.functions.ts");
  const windowHours =
    (Number(windowMsMatch![1]) * Number(windowMsMatch![2]) * Number(windowMsMatch![3])) /
    (60 * 60 * 1000);
  const cooldownHours =
    (Number(cooldownMsMatch![1]) * Number(cooldownMsMatch![2])) / (60 * 60 * 1000);
  assert.ok(retentionHours >= windowHours);
  assert.ok(retentionHours >= cooldownHours);
});

test("GUARDA: a função de limpeza só pode ser executada por service_role (REVOKE de PUBLIC/anon/authenticated explícito na mesma migração)", () => {
  assert.match(
    migrationSrc,
    /REVOKE ALL ON FUNCTION public\.cleanup_old_client_otp_codes\(integer\) FROM PUBLIC, anon, authenticated;/,
  );
  assert.match(
    migrationSrc,
    /GRANT EXECUTE ON FUNCTION public\.cleanup_old_client_otp_codes\(integer\) TO service_role;/,
  );
});

test("GUARDA: a função não usa SECURITY DEFINER (service_role já tem privilégio direto na tabela)", () => {
  // O comentário do cabeçalho do arquivo CITA "SECURITY DEFINER" (explicando
  // por que OUTRAS funções da família precisam dele, e esta não) — por isso
  // não basta `doesNotMatch` no arquivo inteiro. Verifica especificamente o
  // bloco da função: entre "RETURNS integer" e "AS $fn$" só pode haver
  // "LANGUAGE plpgsql", nada de SECURITY DEFINER no meio.
  assert.match(migrationSrc, /RETURNS integer\s*\nLANGUAGE plpgsql\s*\nAS \$\$/);
});

test("GUARDA: a função apaga em lote limitado (LIMIT p_batch_limit) e nunca sem WHERE created_at", () => {
  assert.match(migrationSrc, /LIMIT p_batch_limit/);
  assert.match(migrationSrc, /WHERE created_at < v_cutoff/);
  assert.doesNotMatch(migrationSrc, /DELETE FROM public\.client_otp_codes;/);
});

test("GUARDA: o agendamento (cron.schedule) fica num arquivo SEPARADO, desligado por padrão — mesmo padrão de whatsapp_cron_schedule.sql", () => {
  const cronSrc = readFileSync(
    new URL(
      "../supabase/migrations/20261123190500_client_otp_codes_cleanup_cron_schedule.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.doesNotMatch(migrationSrc, /cron\.schedule/);
  assert.match(cronSrc, /-- select cron\.schedule\(/);
});
