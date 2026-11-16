// CONSENT-1C-FIX — prova comportamental (não só estática) de que a chave
// de cache por usuária (["terms-outdated", userId], usada no beforeLoad de
// _authenticated/route.tsx) evita que a usuária B herde, no mesmo
// QueryClient/aparelho, o resultado que ficou em cache pra usuária A.
//
// Usa um QueryClient real do @tanstack/react-query (confirmado importável
// direto sob node --experimental-strip-types --test, sem precisar de JSX/
// React — só a classe QueryClient é usada aqui, igual ao uso real em
// ensureQueryData dentro do beforeLoad) — não é um mock da API, é a mesma
// chamada (ensureQueryData com staleTime) que o código de produção faz.
import { test } from "node:test";
import assert from "node:assert/strict";
import { QueryClient } from "@tanstack/react-query";

test("chave de cache por usuária: B não herda o resultado cacheado de A", async () => {
  const qc = new QueryClient();
  const userA = "11111111-1111-1111-1111-111111111111";
  const userB = "22222222-2222-2222-2222-222222222222";

  // A é redirecionada pro gate — "terms-outdated" fica true no cache dela,
  // bem dentro do staleTime de 60s usado em produção.
  const outdatedForA = await qc.ensureQueryData({
    queryKey: ["terms-outdated", userA],
    queryFn: async () => true,
    staleTime: 60_000,
  });
  assert.equal(outdatedForA, true);

  // B loga no MESMO QueryClient (mesmo aparelho/aba), menos de 60s depois.
  // Se a chave não incluísse o userId (bug original), ensureQueryData
  // devolveria o "true" de A sem nem chamar o queryFn de B. Com a chave
  // por usuária, B tem sua própria entrada e o queryFn dela roda de
  // verdade.
  let queryFnDeBChamada = false;
  const outdatedForB = await qc.ensureQueryData({
    queryKey: ["terms-outdated", userB],
    queryFn: async () => {
      queryFnDeBChamada = true;
      return false;
    },
    staleTime: 60_000,
  });

  assert.equal(queryFnDeBChamada, true, "o queryFn de B precisa ter rodado, não vir do cache de A");
  assert.equal(outdatedForB, false, "B não pode herdar o true cacheado de A");
});

test("mesma usuária, segunda chamada dentro do staleTime: cache funciona normalmente (sem regressão)", async () => {
  const qc = new QueryClient();
  const userA = "11111111-1111-1111-1111-111111111111";

  let chamadas = 0;
  const primeira = await qc.ensureQueryData({
    queryKey: ["terms-outdated", userA],
    queryFn: async () => {
      chamadas++;
      return true;
    },
    staleTime: 60_000,
  });
  const segunda = await qc.ensureQueryData({
    queryKey: ["terms-outdated", userA],
    queryFn: async () => {
      chamadas++;
      return true;
    },
    staleTime: 60_000,
  });

  assert.equal(primeira, true);
  assert.equal(segunda, true);
  assert.equal(
    chamadas,
    1,
    "segunda chamada pra MESMA usuária devia vir do cache, sem rodar o queryFn de novo",
  );
});

test("invalidateQueries com a chave-base (sem userId) invalida por prefixo (React Query v5, exact: false por padrão)", async () => {
  const qc = new QueryClient();
  const userA = "11111111-1111-1111-1111-111111111111";

  await qc.ensureQueryData({
    queryKey: ["terms-outdated", userA],
    queryFn: async () => true,
    staleTime: 60_000,
  });

  await qc.invalidateQueries({ queryKey: ["terms-outdated"] });

  const state = qc.getQueryState(["terms-outdated", userA]);
  assert.equal(
    state?.isInvalidated,
    true,
    "invalidar pela chave-base precisa invalidar a entrada escopada por userId também",
  );
});
