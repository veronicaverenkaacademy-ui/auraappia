import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extensionForMimeType,
  buildMediaPath,
  isValidMediaPathFormat,
  pathBelongsToMediaKey,
  planImageUpload,
  friendlyQuotaMessage,
  friendlyFileTypeMessage,
  friendlyFileSizeMessage,
  validatePortalMediaFile,
  mapStorageErrorToFriendlyMessage,
  MAX_FILE_BYTES,
  MAX_FILES_PER_COMPANY,
  MAX_TOTAL_BYTES_PER_COMPANY,
} from "../src/lib/portal/portal-media.ts";

const MEDIA_KEY = "11111111-1111-1111-1111-111111111111";
const FILE_ID = "22222222-2222-2222-2222-222222222222";

test("extensionForMimeType mapeia os 3 tipos aceitos e rejeita o resto", () => {
  assert.equal(extensionForMimeType("image/jpeg"), "jpg");
  assert.equal(extensionForMimeType("image/png"), "png");
  assert.equal(extensionForMimeType("image/webp"), "webp");
  assert.equal(extensionForMimeType("image/gif"), null);
  assert.equal(extensionForMimeType("image/svg+xml"), null);
});

test("buildMediaPath monta {mediaKey}/{kind}/{fileId}.{ext}", () => {
  const path = buildMediaPath({
    mediaKey: MEDIA_KEY,
    kind: "logo",
    fileId: FILE_ID,
    mimeType: "image/png",
  });
  assert.equal(path, `${MEDIA_KEY}/logo/${FILE_ID}.png`);
});

test("buildMediaPath lança para mime não suportado", () => {
  assert.throws(() =>
    buildMediaPath({ mediaKey: MEDIA_KEY, kind: "logo", fileId: FILE_ID, mimeType: "image/gif" }),
  );
});

test("isValidMediaPathFormat aceita todo caminho que buildMediaPath monta, para todos os kinds", () => {
  for (const kind of [
    "logo",
    "logo-light",
    "logo-wide",
    "cover",
    "banner",
    "services",
    "professionals",
    "categories",
  ] as const) {
    for (const mime of ["image/jpeg", "image/png", "image/webp"] as const) {
      const path = buildMediaPath({ mediaKey: MEDIA_KEY, kind, fileId: FILE_ID, mimeType: mime });
      assert.equal(isValidMediaPathFormat(path), true, path);
    }
  }
});

test("isValidMediaPathFormat rejeita tentativa de escapar da pasta (../) e kind inexistente", () => {
  assert.equal(isValidMediaPathFormat("../../etc/passwd"), false);
  assert.equal(isValidMediaPathFormat(`${MEDIA_KEY}/avatar/${FILE_ID}.png`), false);
  assert.equal(isValidMediaPathFormat(`${MEDIA_KEY}/logo/nao-e-uuid.png`), false);
  assert.equal(isValidMediaPathFormat(`${MEDIA_KEY}/logo/${FILE_ID}.svg`), false);
});

// ---------------------------------------------------------------------------
// FASE K2c — logo-wide (novo kind)
// ---------------------------------------------------------------------------

test("logo-wide: caminho válido é aceito; kind parecido mas inexistente ('logo-wide-fake') é rejeitado", () => {
  const path = buildMediaPath({
    mediaKey: MEDIA_KEY,
    kind: "logo-wide",
    fileId: FILE_ID,
    mimeType: "image/png",
  });
  assert.equal(path, `${MEDIA_KEY}/logo-wide/${FILE_ID}.png`);
  assert.equal(isValidMediaPathFormat(path), true);
  assert.equal(isValidMediaPathFormat(`${MEDIA_KEY}/logo-wide-fake/${FILE_ID}.png`), false);
});

test("pathBelongsToMediaKey confere só o primeiro segmento", () => {
  const path = `${MEDIA_KEY}/logo/${FILE_ID}.png`;
  assert.equal(pathBelongsToMediaKey(path, MEDIA_KEY), true);
  assert.equal(pathBelongsToMediaKey(path, FILE_ID), false);
});

// ---------------------------------------------------------------------------
// planImageUpload — ponto 2 (estratégia de substituição no limite)
// ---------------------------------------------------------------------------

test("envio novo (sem substituir nada) com uso baixo: upload_direto", () => {
  const plan = planImageUpload({
    usage: { fileCount: 5, totalBytes: 1_000_000 },
    newFileBytes: 500_000,
    replacingBytes: null,
  });
  assert.deepEqual(plan, { allowed: true, strategy: "upload_direto" });
});

test("envio novo quando já está em 60 arquivos: bloqueado por cota_arquivos", () => {
  const plan = planImageUpload({
    usage: { fileCount: MAX_FILES_PER_COMPANY, totalBytes: 1_000 },
    newFileBytes: 1_000,
    replacingBytes: null,
  });
  assert.deepEqual(plan, { allowed: false, reason: "cota_arquivos" });
});

test("envio novo que estouraria 100MB: bloqueado por cota_tamanho", () => {
  const plan = planImageUpload({
    usage: { fileCount: 1, totalBytes: MAX_TOTAL_BYTES_PER_COMPANY - 100 },
    newFileBytes: 1_000,
    replacingBytes: null,
  });
  assert.deepEqual(plan, { allowed: false, reason: "cota_tamanho" });
});

test("substituição (logo por logo maior) cabendo no final: apagar_antes_de_enviar, com aviso", () => {
  // Empresa já no limite de 60 arquivos e perto de 100MB — se a ordem fosse
  // enviar-novo-depois-apagar-antigo, o INSERT do novo sozinho já estouraria
  // os dois limites (61 arquivos / 100MB+novo), mesmo o resultado FINAL
  // (depois de remover o antigo) cabendo direitinho.
  const plan = planImageUpload({
    usage: { fileCount: MAX_FILES_PER_COMPANY, totalBytes: MAX_TOTAL_BYTES_PER_COMPANY - 1_000 },
    newFileBytes: 2_000,
    replacingBytes: 1_500,
  });
  assert.deepEqual(plan, {
    allowed: true,
    strategy: "apagar_antes_de_enviar",
    warnBeforeDelete: true,
  });
});

test("substituição que mesmo removendo a antiga não cabe: bloqueado por cota_tamanho (nenhuma ordem ajuda)", () => {
  const plan = planImageUpload({
    usage: { fileCount: 10, totalBytes: MAX_TOTAL_BYTES_PER_COMPANY - 1_000 },
    newFileBytes: 50_000_000, // a nova é MUITO maior que a antiga
    replacingBytes: 1_000,
  });
  assert.deepEqual(plan, { allowed: false, reason: "cota_tamanho" });
});

test("substituição 1-para-1 nunca é bloqueada por cota_arquivos (contagem final não muda)", () => {
  const plan = planImageUpload({
    usage: { fileCount: MAX_FILES_PER_COMPANY, totalBytes: 1_000 },
    newFileBytes: 1_000,
    replacingBytes: 1_000,
  });
  assert.equal(plan.allowed, true);
});

// ---------------------------------------------------------------------------
// Mensagens amigáveis e validação pré-envio
// ---------------------------------------------------------------------------

test("friendlyQuotaMessage nunca menciona termo técnico", () => {
  const msgArquivos = friendlyQuotaMessage("cota_arquivos");
  const msgTamanho = friendlyQuotaMessage("cota_tamanho");
  for (const msg of [msgArquivos, msgTamanho]) {
    assert.ok(!/insufficient_privilege|42501|RLS|policy/i.test(msg), msg);
  }
  assert.match(msgArquivos, /60 fotos/);
  assert.match(msgTamanho, /100 ?MB/);
});

test("validatePortalMediaFile rejeita tipo errado e tamanho acima de 5MB", () => {
  assert.equal(
    validatePortalMediaFile({ type: "image/gif", size: 1000 }),
    friendlyFileTypeMessage(),
  );
  assert.equal(
    validatePortalMediaFile({ type: "image/png", size: MAX_FILE_BYTES + 1 }),
    friendlyFileSizeMessage(),
  );
  assert.equal(validatePortalMediaFile({ type: "image/png", size: MAX_FILE_BYTES }), null);
});

test("mapStorageErrorToFriendlyMessage nunca repassa o texto técnico do Postgres", () => {
  const msg = mapStorageErrorToFriendlyMessage({
    code: "42501",
    message: "insufficient_privilege",
  });
  assert.ok(!msg.includes("42501"));
  assert.ok(!msg.includes("insufficient_privilege"));
  const generic = mapStorageErrorToFriendlyMessage({ message: "algo totalmente diferente" });
  assert.ok(generic.length > 0);
});
