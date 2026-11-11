// FASE K2c — guarda estática (mesmo padrão de
// portal-image-card-loading-guard.test.ts/portal-preview-isolation-guard.test.ts):
// o cartão "Logo largo" na tela Imagens só pode aparecer quando
// `supportsLogoWide` for true — nunca incondicionalmente — porque até a
// migração ser aplicada em produção a coluna draft_logo_wide_path não
// existe, e salvar esse campo seria silenciosamente ignorado pelo
// `portal_salvar_rascunho` antigo (ver portal-config.server.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const imagesSectionSource = readFileSync(
  new URL("../src/components/portal-editor/images-section.tsx", import.meta.url),
  "utf8",
);

test('o cartão "Logo largo" está condicionado a supportsLogoWide (nunca incondicional)', () => {
  const cardIndex = imagesSectionSource.indexOf('label="Logo largo"');
  assert.notEqual(cardIndex, -1, 'cartão "Logo largo" não encontrado em images-section.tsx');
  const guardIndex = imagesSectionSource.lastIndexOf("supportsLogoWide &&", cardIndex);
  assert.notEqual(
    guardIndex,
    -1,
    'o cartão "Logo largo" precisa estar atrás de "supportsLogoWide &&"',
  );
  assert.ok(
    cardIndex - guardIndex < 200,
    "a checagem de supportsLogoWide precisa envolver diretamente o cartão, não outro trecho distante",
  );
});

test("supportsLogoWide tem default false (nunca aparece por acidente se a tela esquecer de passar a prop)", () => {
  assert.match(imagesSectionSource, /supportsLogoWide\s*=\s*false/);
});
