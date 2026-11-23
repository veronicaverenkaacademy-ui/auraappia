// FASE IA-1 (Parte 3) — gerador DETERMINÍSTICO (seed fixa) de um estúdio
// de cílios/beleza falso, inteiramente em memória — nada é gravado no
// banco. Usa o mesmo formato de entrada do motor de métricas
// (AppointmentForMetrics/ClientForMetrics/...) para alimentar
// buildMetricsBlock() diretamente, igual a uma conta real.
import type {
  AppointmentForMetrics,
  AppointmentStatus,
  BusinessHours,
  ClientForMetrics,
  FinanceTransactionForMetrics,
  ProductForMetrics,
} from "../../aura-metrics/types.ts";

// Mulberry32 — PRNG simples e determinístico (mesma seed = mesma sequência sempre).
function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const FAKE_STUDIO_SEED = 20261123;

const FAKE_FIRST_NAMES = [
  "Ana Teste",
  "Bianca Exemplo",
  "Carla Fictícia",
  "Débora Simulada",
  "Elisa Fake",
  "Fernanda Demo",
  "Gabriela Mock",
  "Helena Sintética",
  "Isabela Falsa",
  "Juliana Artificial",
];
const FAKE_LAST_NAMES = [
  "Silva-Lab",
  "Souza-Lab",
  "Costa-Lab",
  "Pereira-Lab",
  "Lima-Lab",
  "Alves-Lab",
];

const SERVICES = [
  { name: "Volume Russo", price: 180 },
  { name: "Volume Brasileiro", price: 150 },
  { name: "Fio a Fio", price: 90 },
  { name: "Manutenção Volume Russo", price: 110 },
  { name: "Design de Sobrancelha", price: 60 },
  { name: "Lash Lifting", price: 130 },
];

export interface FakeStudioData {
  appointments: AppointmentForMetrics[];
  clients: ClientForMetrics[];
  transactions: FinanceTransactionForMetrics[];
  products: ProductForMetrics[];
  businessHours: BusinessHours;
  /** Nomes falsos por clientId — só usados pelo Laboratório pra repor nos rótulos na tela, NUNCA
   * enviados ao provedor (mesmo caminho de pseudonimização de produção é usado aqui também). */
  fakeNamesByClientId: Map<string, string>;
  now: Date;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export function generateFakeStudio(
  now: Date = new Date(),
  seed: number = FAKE_STUDIO_SEED,
): FakeStudioData {
  const rng = mulberry32(seed);
  const pick = <T>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];

  const sixMonthsAgo = addDays(now, -182);
  const clients: ClientForMetrics[] = [];
  const fakeNamesByClientId = new Map<string, string>();
  const appointments: AppointmentForMetrics[] = [];
  let apptCounter = 0;

  const CLIENT_COUNT = 60;
  for (let i = 0; i < CLIENT_COUNT; i++) {
    const clientId = `fake-client-${i + 1}`;
    const name = `${pick(FAKE_FIRST_NAMES)} ${pick(FAKE_LAST_NAMES)} ${i + 1}`;
    const createdAt = addDays(sixMonthsAgo, Math.floor(rng() * 150));
    clients.push({ id: clientId, createdAt, anonymized: false });
    fakeNamesByClientId.set(clientId, name);

    // Perfil da cliente: "fiel" (mantém o ritmo até hoje), "sumindo" (parou de vir há tempo),
    // "nova" (poucas visitas recentes), "cancela_muito" (várias faltas/cancelamentos).
    const profileRoll = rng();
    const profile =
      profileRoll < 0.55
        ? "fiel"
        : profileRoll < 0.75
          ? "sumindo"
          : profileRoll < 0.9
            ? "nova"
            : "cancela_muito";

    let cursor = addDays(createdAt, Math.floor(rng() * 10) + 1);
    const rhythmDays = 15 + Math.floor(rng() * 7); // 15-21 dias, pedido da fase
    const visitsTarget =
      profile === "nova"
        ? 1 + Math.floor(rng() * 2)
        : profile === "sumindo"
          ? 3 + Math.floor(rng() * 3)
          : 6 + Math.floor(rng() * 10);

    for (let v = 0; v < visitsTarget && cursor.getTime() < now.getTime(); v++) {
      const service = pick(SERVICES);
      let status: AppointmentStatus = "completed";
      if (profile === "cancela_muito" && rng() < 0.35) {
        status = rng() < 0.5 ? "cancelled" : "no_show";
      } else if (rng() < 0.05) {
        status = "no_show";
      }
      appointments.push({
        id: `fake-appt-${apptCounter++}`,
        clientId,
        serviceId: null,
        serviceName: service.name,
        startsAt: cursor,
        endsAt: new Date(cursor.getTime() + 90 * 60_000),
        status,
        price: service.price,
      });
      cursor = addDays(cursor, rhythmDays + Math.floor(rng() * 5) - 2);
      if (profile === "sumindo" && v === visitsTarget - 1) {
        // última visita bem no passado — para a cliente ficar "sumida" de verdade em relação a `now`.
        break;
      }
    }

    // Algumas clientes fiéis têm agendamento FUTURO (não cancelado).
    if (profile === "fiel" && rng() < 0.4) {
      const service = pick(SERVICES);
      const futureDate = addDays(now, 1 + Math.floor(rng() * 20));
      appointments.push({
        id: `fake-appt-${apptCounter++}`,
        clientId,
        serviceId: null,
        serviceName: service.name,
        startsAt: futureDate,
        endsAt: new Date(futureDate.getTime() + 90 * 60_000),
        status: rng() < 0.7 ? "confirmed" : "pending",
        price: service.price,
      });
    }
  }

  // Lançamentos financeiros: um "income" pago por atendimento completed (igual ao preço) + algumas
  // despesas fixas mensais — simples, só pra alimentar revenueComparison.
  const transactions: FinanceTransactionForMetrics[] = [];
  let txCounter = 0;
  for (const a of appointments) {
    if (a.status === "completed") {
      transactions.push({
        id: `fake-tx-${txCounter++}`,
        kind: "income",
        amount: a.price,
        status: "paid",
        paidAt: a.startsAt,
      });
    }
  }
  for (let m = 0; m < 6; m++) {
    transactions.push({
      id: `fake-tx-expense-${m}`,
      kind: "expense",
      amount: 800 + Math.floor(rng() * 200),
      status: "paid",
      paidAt: addDays(now, -30 * m),
    });
  }

  const products: ProductForMetrics[] = [
    { id: "fake-prod-1", name: "Cola para cílios", stock: 2, minStock: 5, unit: "un" },
    { id: "fake-prod-2", name: "Fita microporosa", stock: 15, minStock: 5, unit: "un" },
    { id: "fake-prod-3", name: "Fios 0.07 mix", stock: 3, minStock: 4, unit: "cx" },
  ];

  const businessHours: BusinessHours = {
    mon: { open: "09:00", close: "19:00" },
    tue: { open: "09:00", close: "19:00" },
    wed: { open: "09:00", close: "19:00" },
    thu: { open: "09:00", close: "19:00" },
    fri: { open: "09:00", close: "19:00" },
    sat: { open: "09:00", close: "14:00" },
    sun: null,
  };

  return { appointments, clients, transactions, products, businessHours, fakeNamesByClientId, now };
}
