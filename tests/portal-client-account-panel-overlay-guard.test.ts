// Guarda estática (FASE K2b-FIX): o bug em produção ("Meus agendamentos" do
// atalho e do menu não fazia nada) foi causado por envolver
// <ClientAccountPanel> num wrapper "sr-only" em l.$slug.tsx — isso clipa
// (deixa invisível) o conteúdo normal-flow que o painel renderiza quando
// aberto (telefone/código/cadastro). Este teste garante que esse wrapper
// nunca mais volte a envolver o painel na home pública, e que o próprio
// painel sempre apresente suas telas de login como sobreposição em tela
// cheia (mesmo padrão já usado pelo painel logado) — nunca como conteúdo
// "solto" dentro do fluxo normal da página.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

test("l.$slug.tsx nunca envolve <ClientAccountPanel> num wrapper sr-only", () => {
  const src = stripComments(readFileSync("src/routes/l.$slug.tsx", "utf8"));
  const idx = src.indexOf("<ClientAccountPanel");
  assert.ok(idx > -1, "ClientAccountPanel precisa continuar montado na home pública");

  // A home pública não tem (e não deve ter) nenhum outro uso legítimo de
  // "sr-only" — é exatamente a classe usada no defeito original (K2b) pra
  // envolver o painel, clipando pra invisível tudo que ele renderiza quando
  // aberto. Checar a ausência total da classe no arquivo é mais confiável
  // do que tentar casar aninhamento de <div> por regex.
  assert.ok(
    !/\bsr-only\b/.test(src),
    "l.$slug.tsx não deveria usar a classe sr-only em lugar nenhum (ver comentário no topo deste teste)",
  );
});

test("client-account-panel.tsx apresenta telefone/código/cadastro como sobreposição em tela cheia (fixed inset-0), igual ao painel logado", () => {
  const src = stripComments(readFileSync("src/components/portal/client-account-panel.tsx", "utf8"));

  // As 3 etapas de login devem estar dentro de um bloco que usa fixed
  // inset-0 (mesma classe que o ClientDashboard já usa) — não soltas
  // direto num <div> comum, que fica preso a onde o componente foi
  // montado na página (o defeito original).
  const authBlockMatch = src.match(
    /auth\.view !== "closed"[\s\S]{0,200}fixed inset-0[\s\S]{0,400}PhoneStep/,
  );
  assert.ok(
    authBlockMatch,
    'as etapas de login (PhoneStep/OtpStep/SignupStep) precisam estar dentro de uma sobreposição fixed inset-0 quando auth.view !== "closed"',
  );
});
