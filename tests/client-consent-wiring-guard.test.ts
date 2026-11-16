// FASE CONSENT-1D — guardas estáticas da integração do gate nos DOIS
// pontos que resolvem cliente no portal (confirma que a solução vale pra
// TODA cliente, nova ou pré-cadastrada, qualquer que seja o caminho) e do
// ajuste de texto da caixinha legada de cadastro.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const useClientAuthSrc = read("src/hooks/use-client-auth.ts");
const panelSrc = read("src/components/portal/client-account-panel.tsx");
const bookingSrc = read("src/components/portal/booking-flow.tsx");
const authStepsSrc = read("src/components/portal/client-auth-steps.tsx");

test("GUARDA: ClientAuthView inclui 'consent' entre 'signup' e 'ready'", () => {
  assert.match(
    useClientAuthSrc,
    /"closed" \| "phone" \| "otp" \| "signup" \| "consent" \| "ready"/,
  );
});

test("GUARDA: resolveClient NUNCA pula direto pra 'ready' — sempre passa por 'consent' primeiro", () => {
  const block = useClientAuthSrc.slice(
    useClientAuthSrc.indexOf("const resolveClient"),
    useClientAuthSrc.indexOf("const start ="),
  );
  assert.match(block, /setView\("consent"\)/);
  assert.doesNotMatch(block, /setView\("ready"\)/);
});

test("GUARDA: ClientAccountPanel importa e renderiza ClientConsentGate quando auth.view === 'consent'", () => {
  assert.match(panelSrc, /import \{ ClientConsentGate \} from "\.\/client-consent-gate"/);
  assert.match(panelSrc, /auth\.view === "consent" && auth\.myClient/);
  assert.match(panelSrc, /onDone=\{\(\) => auth\.setView\("ready"\)\}/);
});

test("GUARDA: BookingFlow importa e renderiza ClientConsentGate quando auth.view === 'consent' (funil de agendamento também passa pelo gate)", () => {
  assert.match(bookingSrc, /import \{ ClientConsentGate \} from "\.\/client-consent-gate"/);
  assert.match(bookingSrc, /auth\.view === "consent" && auth\.myClient/);
  assert.match(bookingSrc, /onDone=\{\(\) => auth\.setView\("ready"\)\}/);
});

test("GUARDA: os DOIS consumidores passam clientId=auth.myClient.id pro gate (identidade real, não um placeholder)", () => {
  assert.match(panelSrc, /clientId=\{auth\.myClient\.id\}/);
  assert.match(bookingSrc, /clientId=\{auth\.myClient\.id\}/);
});

test("GUARDA: o useEffect que abre o dashboard em ClientAccountPanel continua exigindo view==='ready' (não 'consent')", () => {
  assert.match(
    panelSrc,
    /if \(auth\.view === "ready" && auth\.myClient\) setShowDashboard\(true\);/,
  );
});

test("GUARDA: a caixinha legada de client-auth-steps.tsx (SignupStep) agora linka Termos de Uso + Política de Privacidade (não mais Termo de Consentimento)", () => {
  const block = authStepsSrc.slice(
    authStepsSrc.indexOf("checked={signup.accepted_terms}") - 200,
    authStepsSrc.indexOf("checked={signup.accepted_terms}") + 600,
  );
  assert.match(block, /to="\/termos-de-uso"/);
  assert.match(block, /to="\/politica-de-privacidade"/);
  assert.doesNotMatch(block, /to="\/termo-consentimento"/);
});

test("GUARDA: accepted_terms/onCheckedChange da caixinha legada continuam intocados (lógica de OTP/cadastro inalterada)", () => {
  assert.match(authStepsSrc, /checked=\{signup\.accepted_terms\}/);
  assert.match(
    authStepsSrc,
    /onCheckedChange=\{\(v\) => patch\(\{ accepted_terms: v === true \}\)\}/,
  );
  assert.match(authStepsSrc, /disabled=\{loading \|\| !signup\.accepted_terms\}/);
});
