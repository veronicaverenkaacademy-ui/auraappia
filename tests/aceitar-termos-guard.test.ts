// FASE CONSENT-1C (16/11/2026): guardas estáticas de
// src/routes/aceitar-termos.tsx (contém JSX — não dá pra importar direto
// num node:test puro, mesmo padrão de tests/conta-excluida.test.ts) e do
// beforeLoad de _authenticated/route.tsx que decide quando redirecionar
// pra lá.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const gate = read("src/routes/aceitar-termos.tsx");
const authGuard = read("src/routes/_authenticated/route.tsx");

test("GUARDA: /aceitar-termos é rota de topo (fora de _authenticated), exige sessão própria", () => {
  assert.match(gate, /createFileRoute\("\/aceitar-termos"\)/);
  assert.doesNotMatch(gate, /createFileRoute\("\/_authenticated/);
  assert.match(gate, /beforeLoad:/);
  assert.match(gate, /if \(!session\)/);
});

test("GUARDA: checkbox de aceite começa DESMARCADO (useState(false))", () => {
  assert.match(gate, /const \[checked, setChecked\] = useState\(false\)/);
});

test("GUARDA: botão 'Aceitar e continuar' fica desabilitado até marcar o checkbox", () => {
  assert.match(gate, /disabled=\{!checked \|\| accept\.isPending\}/);
});

test("GUARDA: links apontam pras rotas públicas reais de Termos e Política (sem parâmetro extra)", () => {
  assert.match(gate, /to="\/termos-de-uso"/);
  assert.match(gate, /to="\/politica-de-privacidade"/);
});

test("GUARDA: existe caminho pra excluir a conta (link discreto pra /seguranca) e pra sair (Sair)", () => {
  assert.match(gate, /to="\/seguranca"/);
  assert.match(gate, />\s*Sair\s*</);
});

test("GUARDA: estado de erro (fail-safe) tem 'Tentar novamente' e 'Sair' — nunca trava sem saída", () => {
  assert.match(gate, /isError/);
  assert.match(gate, /Tentar novamente/);
});

test("GUARDA: enquanto carrega, não renderiza o conteúdo do gate nem do app (sem flash)", () => {
  assert.match(gate, /if \(isLoading\)/);
});

test("GUARDA: aceitar invalida terms-status E terms-outdated (as duas chaves de cache, não só uma)", () => {
  assert.match(gate, /invalidateQueries\(\{ queryKey: \["terms-status"\] \}\)/);
  assert.match(gate, /invalidateQueries\(\{ queryKey: \["terms-outdated"\] \}\)/);
});

test("GUARDA: _authenticated/route.tsx redireciona pra /aceitar-termos quando desatualizado", () => {
  assert.match(authGuard, /getMyTermsOutdated/);
  assert.match(authGuard, /redirect\(\{ to: "\/aceitar-termos" \}\)/);
});

test("GUARDA: /seguranca fica de fora do redirecionamento do gate (exceção explícita)", () => {
  assert.match(authGuard, /location\.pathname !== "\/seguranca"/);
});

test("GUARDA: rotas públicas (termos legais, exclusão de conta, portal, login) continuam fora de _authenticated/", () => {
  const publicos = [
    "src/routes/termos-de-uso.tsx",
    "src/routes/politica-de-privacidade.tsx",
    "src/routes/termo-consentimento.tsx",
    "src/routes/conta-excluida.tsx",
    "src/routes/portal.tsx",
    "src/routes/auth.tsx",
  ];
  for (const path of publicos) {
    assert.ok(existsSync(new URL(`../${path}`, import.meta.url)), `${path} deveria existir`);
    assert.ok(!path.includes("_authenticated"), `${path} não deveria estar sob _authenticated`);
  }
});
