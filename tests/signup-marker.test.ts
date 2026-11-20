// FASE AUTH-1 (20/11/2026) — testa o marcador de cadastro em andamento
// (src/lib/signup.ts: markSignupInProgress/hasSignupInProgress/
// clearSignupInProgress), criado pra sobreviver ao redirect de página
// inteira do OAuth (Apple/Google) — ver comentário no próprio arquivo e em
// src/routes/auth.tsx. Como o módulo lê `window.sessionStorage` só dentro
// das funções (não no top-level do módulo), dá pra simular um
// `window`/sessionStorage falso ANTES de importar, sem precisar de jsdom.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

function makeFakeSessionStorage(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    get size() {
      return store.size;
    },
  };
}

// `window` não existe em node:test puro — criamos um mínimo suficiente.
(globalThis as unknown as { window: unknown }).window = {
  sessionStorage: makeFakeSessionStorage(),
};

const { markSignupInProgress, hasSignupInProgress, clearSignupInProgress, SIGNUP_MARKER_KEY } =
  await import("../src/lib/signup.ts");

function setWindowStorage(storage: ReturnType<typeof makeFakeSessionStorage> | undefined) {
  (globalThis as unknown as { window: { sessionStorage: unknown } }).window = {
    sessionStorage: storage,
  };
}

beforeEach(() => {
  setWindowStorage(makeFakeSessionStorage());
});

test("markSignupInProgress + hasSignupInProgress: grava e lê um marcador válido", () => {
  assert.equal(hasSignupInProgress(), false);
  markSignupInProgress();
  assert.equal(hasSignupInProgress(), true);
});

test("hasSignupInProgress: sem marcador nenhum, devolve false", () => {
  assert.equal(hasSignupInProgress(), false);
});

test("clearSignupInProgress: apaga o marcador — hasSignupInProgress volta a false", () => {
  markSignupInProgress();
  assert.equal(hasSignupInProgress(), true);
  clearSignupInProgress();
  assert.equal(hasSignupInProgress(), false);
});

test("hasSignupInProgress: marcador expirado (expiresAt no passado) devolve false e se autolimpa", () => {
  const storage = makeFakeSessionStorage({
    [SIGNUP_MARKER_KEY]: JSON.stringify({ active: true, expiresAt: Date.now() - 1000 }),
  });
  setWindowStorage(storage);
  assert.equal(hasSignupInProgress(), false);
  assert.equal(storage.getItem(SIGNUP_MARKER_KEY), null, "marcador expirado deveria ser removido");
});

test("hasSignupInProgress: JSON malformado no storage devolve false sem lançar", () => {
  const storage = makeFakeSessionStorage({ [SIGNUP_MARKER_KEY]: "{ isso não é json" });
  setWindowStorage(storage);
  assert.doesNotThrow(() => hasSignupInProgress());
  assert.equal(hasSignupInProgress(), false);
});

test("hasSignupInProgress: marcador com active=false devolve false", () => {
  const storage = makeFakeSessionStorage({
    [SIGNUP_MARKER_KEY]: JSON.stringify({ active: false, expiresAt: Date.now() + 10_000 }),
  });
  setWindowStorage(storage);
  assert.equal(hasSignupInProgress(), false);
});

test("funciona com sessionStorage indisponível: markSignupInProgress nunca lança", () => {
  setWindowStorage(undefined as unknown as ReturnType<typeof makeFakeSessionStorage>);
  assert.doesNotThrow(() => markSignupInProgress());
});

test("funciona com sessionStorage indisponível: hasSignupInProgress devolve false sem lançar", () => {
  setWindowStorage(undefined as unknown as ReturnType<typeof makeFakeSessionStorage>);
  assert.doesNotThrow(() => {
    assert.equal(hasSignupInProgress(), false);
  });
});

test("funciona com sessionStorage indisponível: clearSignupInProgress nunca lança", () => {
  setWindowStorage(undefined as unknown as ReturnType<typeof makeFakeSessionStorage>);
  assert.doesNotThrow(() => clearSignupInProgress());
});

test("funciona quando sessionStorage.getItem lança (ex.: modo privado bloqueando storage)", () => {
  setWindowStorage({
    getItem: () => {
      throw new Error("SecurityError: storage bloqueado");
    },
    setItem: () => {
      throw new Error("SecurityError: storage bloqueado");
    },
    removeItem: () => {
      throw new Error("SecurityError: storage bloqueado");
    },
    clear: () => {},
    size: 0,
  } as unknown as ReturnType<typeof makeFakeSessionStorage>);
  assert.doesNotThrow(() => markSignupInProgress());
  assert.doesNotThrow(() => {
    assert.equal(hasSignupInProgress(), false);
  });
  assert.doesNotThrow(() => clearSignupInProgress());
});
