import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// ---- Types shared with the client ----

export type AuraMessage = { role: "user" | "assistant" | "system"; content: string };

export type AuraInsight = {
  id: string;
  tone: "positive" | "warning" | "info" | "neutral";
  icon: "alert" | "package" | "trend-up" | "clock" | "sparkles" | "wallet" | "users";
  title: string;
  detail: string;
  action?: string;
};

export type AuraSummary = {
  greeting: string;
  headline: string;
  todayAppointments: number;
  todayRevenueForecast: number;
  occupancyPct: number;
  weekRevenue: number;
  monthRevenue: number;
  inactiveClients: number;
  lowStock: number;
  insights: AuraInsight[];
};

export type CouncilPerspective = {
  role: string;
  tag: string;
  tone: "green" | "blue" | "purple" | "amber" | "red";
  analysis: string;
};

export type CouncilVerdict = {
  question: string;
  perspectives: CouncilPerspective[];
  recommendation: string;
  impact: string;
  status: "recomendado" | "atencao" | "nao_recomendado";
};

// ---- Helpers ----

function startOfDay(d = new Date()) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function endOfDay(d = new Date()) { const x = new Date(d); x.setHours(23,59,59,999); return x; }
function startOfMonth(d = new Date()) { const x = new Date(d); x.setDate(1); x.setHours(0,0,0,0); return x; }
function endOfMonth(d = new Date()) { const x = startOfMonth(d); x.setMonth(x.getMonth()+1); x.setMilliseconds(-1); return x; }
function brl(n: number) { return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function gatherContext(supabase: any) {
  const now = new Date();
  const dayStart = startOfDay(now).toISOString();
  const dayEnd = endOfDay(now).toISOString();
  const mStart = startOfMonth(now).toISOString();
  const mEnd = endOfMonth(now).toISOString();
  const week = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString();

  const [today, monthTx, weekTx, clients, products, activeClientIds] = await Promise.all([
    supabase.from("appointments").select("id, price, status, service_name, starts_at").gte("starts_at", dayStart).lte("starts_at", dayEnd),
    supabase.from("finance_transactions").select("amount, kind, status, paid_at, description").gte("paid_at", mStart).lte("paid_at", mEnd).eq("status", "paid"),
    supabase.from("finance_transactions").select("amount, kind, description").gte("paid_at", week).eq("status", "paid").eq("kind", "income"),
    supabase.from("clients").select("id, full_name, created_at"),
    supabase.from("products").select("id, name, stock, min_stock, unit"),
    supabase.from("appointments").select("client_id").gte("starts_at", thirtyDaysAgo),
  ]);

  const todayList = (today.data ?? []) as Array<{ price: number; status: string; service_name: string | null; starts_at: string }>;
  const monthList = (monthTx.data ?? []) as Array<{ amount: number; kind: string; description: string | null }>;
  const weekList = (weekTx.data ?? []) as Array<{ amount: number; description: string | null }>;
  const clientList = (clients.data ?? []) as Array<{ id: string; full_name: string }>;
  const productList = (products.data ?? []) as Array<{ name: string; stock: number; min_stock: number; unit: string }>;
  const activeIds = new Set(((activeClientIds.data ?? []) as Array<{ client_id: string }>).map((r) => r.client_id));

  const todayRevenueForecast = todayList.filter((a) => a.status !== "cancelled").reduce((s, a) => s + Number(a.price || 0), 0);
  const monthRevenue = monthList.filter((t) => t.kind === "income").reduce((s, t) => s + Number(t.amount), 0);
  const monthExpense = monthList.filter((t) => t.kind === "expense").reduce((s, t) => s + Number(t.amount), 0);
  const weekRevenue = weekList.reduce((s, t) => s + Number(t.amount), 0);

  const serviceMap = new Map<string, { count: number; revenue: number }>();
  for (const t of weekList) {
    const key = t.description ?? "Outros";
    const cur = serviceMap.get(key) ?? { count: 0, revenue: 0 };
    cur.count += 1; cur.revenue += Number(t.amount);
    serviceMap.set(key, cur);
  }
  const bestService = Array.from(serviceMap.entries()).sort((a,b) => b[1].revenue - a[1].revenue)[0];

  const inactiveClients = clientList.filter((c) => !activeIds.has(c.id)).length;
  const lowStock = productList.filter((p) => Number(p.stock) <= Number(p.min_stock)).length;
  const criticalStock = productList
    .filter((p) => Number(p.stock) <= Number(p.min_stock))
    .slice(0, 3)
    .map((p) => `${p.name} (${p.stock} ${p.unit})`);

  const occupancy = todayList.length > 0 ? Math.min(100, Math.round((todayList.length / 10) * 100)) : 0;

  return {
    now,
    todayAppointments: todayList.length,
    todayRevenueForecast,
    monthRevenue,
    monthExpense,
    weekRevenue,
    weekProfit: weekRevenue * 0.68,
    inactiveClients,
    totalClients: clientList.length,
    lowStock,
    criticalStock,
    bestService: bestService ? { name: bestService[0], revenue: bestService[1].revenue } : null,
    occupancy,
  };
}

// ---- Executive Summary ----

export const getExecutiveSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AuraSummary> => {
    const ctx = await gatherContext(context.supabase);
    const hour = ctx.now.getHours();
    const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";

    const insights: AuraInsight[] = [];

    if (ctx.inactiveClients > 0) {
      insights.push({
        id: "inactive",
        tone: "warning",
        icon: "users",
        title: `${ctx.inactiveClients} clientes sem retorno há 30 dias`,
        detail: `Potencial estimado de ${brl(ctx.inactiveClients * 180)} em receita a recuperar.`,
        action: "Criar campanha de reativação",
      });
    }
    if (ctx.lowStock > 0) {
      insights.push({
        id: "stock",
        tone: "warning",
        icon: "package",
        title: `${ctx.lowStock} produtos abaixo do estoque mínimo`,
        detail: ctx.criticalStock.length ? `Prioridade: ${ctx.criticalStock.join(", ")}.` : "Baseado no consumo médio recente.",
        action: "Ver lista de compras",
      });
    }
    if (ctx.bestService) {
      insights.push({
        id: "best",
        tone: "positive",
        icon: "trend-up",
        title: `${ctx.bestService.name} lidera a receita da semana`,
        detail: `Contribuiu com ${brl(ctx.bestService.revenue)} nos últimos 7 dias.`,
        action: "Ver relatório",
      });
    }
    if (ctx.todayAppointments === 0) {
      insights.push({
        id: "empty",
        tone: "info",
        icon: "clock",
        title: "Sua agenda de hoje está livre",
        detail: "Vale abrir a agenda online e disparar uma campanha de horários disponíveis.",
        action: "Abrir agenda",
      });
    } else if (ctx.occupancy >= 90) {
      insights.push({
        id: "full",
        tone: "info",
        icon: "clock",
        title: `Agenda ${ctx.occupancy}% ocupada hoje`,
        detail: "Considere abrir horários extras ou uma lista de espera para encaixes.",
        action: "Gerir horários",
      });
    }
    if (ctx.monthRevenue > 0) {
      insights.push({
        id: "revenue",
        tone: "positive",
        icon: "wallet",
        title: `Faturamento do mês: ${brl(ctx.monthRevenue)}`,
        detail: `Despesas registradas: ${brl(ctx.monthExpense)} · Lucro estimado: ${brl(ctx.monthRevenue - ctx.monthExpense)}.`,
        action: "Ver DRE",
      });
    }

    return {
      greeting: `${greeting}`,
      headline: ctx.todayAppointments > 0
        ? `Você tem ${ctx.todayAppointments} atendimento${ctx.todayAppointments > 1 ? "s" : ""} hoje. Receita prevista de ${brl(ctx.todayRevenueForecast)}.`
        : `Nenhum atendimento na agenda hoje. Faturamento do mês: ${brl(ctx.monthRevenue)}.`,
      todayAppointments: ctx.todayAppointments,
      todayRevenueForecast: ctx.todayRevenueForecast,
      occupancyPct: ctx.occupancy,
      weekRevenue: ctx.weekRevenue,
      monthRevenue: ctx.monthRevenue,
      inactiveClients: ctx.inactiveClients,
      lowStock: ctx.lowStock,
      insights: insights.slice(0, 6),
    };
  });

// ---- Chat with Aura ----

const ChatInput = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().min(1).max(4000),
  })).min(1).max(30),
});

function contextToPrompt(ctx: Awaited<ReturnType<typeof gatherContext>>) {
  return [
    `Data/hora atual: ${ctx.now.toLocaleString("pt-BR")}`,
    `Atendimentos hoje: ${ctx.todayAppointments} · Receita prevista hoje: ${brl(ctx.todayRevenueForecast)}`,
    `Faturamento semana (7d): ${brl(ctx.weekRevenue)} · Lucro estimado: ${brl(ctx.weekProfit)}`,
    `Faturamento mês: ${brl(ctx.monthRevenue)} · Despesas mês: ${brl(ctx.monthExpense)} · Lucro estimado: ${brl(ctx.monthRevenue - ctx.monthExpense)}`,
    `Clientes cadastradas: ${ctx.totalClients} · Sem retorno em 30 dias: ${ctx.inactiveClients}`,
    `Produtos abaixo do estoque mínimo: ${ctx.lowStock}${ctx.criticalStock.length ? ` (${ctx.criticalStock.join(", ")})` : ""}`,
    ctx.bestService ? `Serviço com maior receita na semana: ${ctx.bestService.name} (${brl(ctx.bestService.revenue)})` : `Sem serviços registrados na semana.`,
    `Ocupação estimada da agenda hoje: ${ctx.occupancy}%`,
  ].join("\n");
}

const SYSTEM_PROMPT = `Você é a AURA, a Gerente Executiva de Inteligência do aplicativo AURA para profissionais da beleza.
Você NÃO é um chatbot genérico. Você acompanha diariamente a empresa da usuária e responde como uma gerente sênior: direta, estratégica, calorosa e baseada em dados reais.

Diretrizes:
- Sempre em português do Brasil, tom profissional e humano.
- Use APENAS os dados fornecidos na seção "CONTEXTO OPERACIONAL". Se um dado não estiver disponível, diga isso e sugira como obtê-lo.
- Respostas curtas por padrão (máx. 6 linhas). Use listas com "•" quando ajudar.
- Sempre que possível, termine com uma recomendação ou próximo passo executável.
- Formate valores em Real (R$) e percentuais.
- Nunca invente números. Nunca prometa executar ações críticas — sugira e peça confirmação.`;

export const chatWithAura = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ChatInput.parse(input))
  .handler(async ({ data, context }): Promise<{ reply: string }> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY não configurado.");

    const ctx = await gatherContext(context.supabase);
    const contextBlock = contextToPrompt(ctx);

    const systemMessages: AuraMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "system", content: `CONTEXTO OPERACIONAL (dados reais do negócio agora):\n${contextBlock}` },
    ];

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "google/gemini-3.6-flash",
        messages: [...systemMessages, ...data.messages],
        temperature: 0.6,
      }),
    });

    if (res.status === 429) throw new Error("Limite de requisições atingido. Tente novamente em alguns instantes.");
    if (res.status === 402) throw new Error("Créditos de IA esgotados. Adicione créditos nas configurações da Lovable.");
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Falha na Aura IA (${res.status}): ${text.slice(0, 200)}`);
    }

    const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const reply = json.choices?.[0]?.message?.content?.trim();
    if (!reply) throw new Error("Resposta vazia da Aura IA.");
    return { reply };
  });

// ---- Executive Council ----

const CouncilInput = z.object({ question: z.string().min(3).max(400) });

export const askCouncil = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CouncilInput.parse(input))
  .handler(async ({ data, context }): Promise<CouncilVerdict> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY não configurado.");

    const ctx = await gatherContext(context.supabase);
    const contextBlock = contextToPrompt(ctx);

    const system = `Você é o Conselho Executivo da AURA IA. Reúna 4 perspectivas especializadas para responder à pergunta estratégica da profissional da beleza.
Sempre use os dados reais do CONTEXTO OPERACIONAL. Se algum dado faltar, diga "dado indisponível" na análise correspondente.
Retorne SOMENTE um JSON válido (sem markdown, sem crases) no formato:
{
  "perspectives": [
    { "role": "Diretora Financeira", "tag": "Lucro, fluxo de caixa e metas", "tone": "green", "analysis": "..." },
    { "role": "Gestora Operacional", "tag": "Agenda, capacidade e eficiência", "tone": "blue", "analysis": "..." },
    { "role": "Especialista em Marketing", "tag": "Campanhas e fidelização", "tone": "purple", "analysis": "..." },
    { "role": "Analista de Estoque", "tag": "Consumo e reposição", "tone": "amber", "analysis": "..." }
  ],
  "recommendation": "Parágrafo consolidado de 2 a 4 frases, direto ao ponto.",
  "impact": "Estimativa do impacto (ex.: +R$ 4.200/mês em 8 semanas)",
  "status": "recomendado" | "atencao" | "nao_recomendado"
}
Cada análise deve ter no máximo 2 frases.`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "google/gemini-3.6-flash",
        messages: [
          { role: "system", content: system },
          { role: "system", content: `CONTEXTO OPERACIONAL:\n${contextBlock}` },
          { role: "user", content: data.question },
        ],
        temperature: 0.5,
        response_format: { type: "json_object" },
      }),
    });

    if (res.status === 429) throw new Error("Limite de requisições atingido.");
    if (res.status === 402) throw new Error("Créditos de IA esgotados.");
    if (!res.ok) throw new Error(`Falha no Conselho (${res.status}).`);

    const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const raw = json.choices?.[0]?.message?.content ?? "{}";
    let parsed: Partial<CouncilVerdict> = {};
    try {
      const stripped = raw.replace(/^```(?:json)?/i, "").replace(/```$/,"").trim();
      parsed = JSON.parse(stripped);
    } catch {
      parsed = {};
    }

    return {
      question: data.question,
      perspectives: (parsed.perspectives ?? []).slice(0, 6),
      recommendation: parsed.recommendation ?? "A Aura não conseguiu consolidar uma recomendação com os dados atuais.",
      impact: parsed.impact ?? "Impacto não estimado.",
      status: parsed.status ?? "atencao",
    };
  });