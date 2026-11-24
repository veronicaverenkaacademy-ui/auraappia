// FASE IA-3 (item 1.f) — override de max_tokens só do chat do Laboratório (nunca do relatório
// semanal, nunca de generate.server.ts/produção), lido da variável de ambiente
// AURA_LAB_CHAT_MAX_TOKENS pra a dona poder experimentar outro limite sem precisar de um novo
// deploy. Valor inválido/fora de [256, 4000] é silenciosamente ignorado — nunca lança erro, só cai
// no default normal do adaptador (ver maxTokensForTask em anthropic.server.ts).
//
// Módulo isolado SEM NENHUM import (nem relativo, nem "@/...") de propósito: laboratory.functions.ts
// importa de "@tanstack/react-start"/"@/..." e não pode ser carregado como módulo ES direto pelo
// node:test (sem o resolvedor de alias do bundler) — mantendo essa função pura aqui, os testes
// (tests/aura-ai-laboratory.test.ts) importam só este arquivo, sem puxar essa cadeia.
export const LAB_CHAT_MAX_TOKENS_MIN = 256;
export const LAB_CHAT_MAX_TOKENS_MAX = 4000;

export function parseLabChatMaxTokensOverride(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n)) return undefined;
  if (n < LAB_CHAT_MAX_TOKENS_MIN || n > LAB_CHAT_MAX_TOKENS_MAX) return undefined;
  return n;
}
