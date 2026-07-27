import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import heroImg from "@/assets/hero.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Agende com Marina · AURA" },
      { name: "description", content: "Reserve seu horário em segundos. Estúdio Marina Bastos — Lash, brow e beauty." },
      { property: "og:title", content: "Agende com Marina · AURA" },
      { property: "og:description", content: "Reserve seu horário em segundos." },
    ],
  }),
  component: Index,
});

type Service = {
  id: string;
  name: string;
  duration: string;
  price: string;
  note?: string;
};

const services: Service[] = [
  { id: "volume", name: "Volume Brasileiro", duration: "2h 30", price: "R$ 220", note: "Aplicação completa" },
  { id: "manut", name: "Manutenção Volume", duration: "1h 30", price: "R$ 140", note: "Até 20 dias" },
  { id: "brow", name: "Design de Sobrancelhas", duration: "45 min", price: "R$ 90" },
  { id: "lash-lift", name: "Lash Lifting + Tint", duration: "1h", price: "R$ 160" },
];

const times = ["09:00", "09:30", "10:00", "11:30", "13:00", "14:30", "15:00", "16:30", "17:00"];

function buildDays() {
  const base = new Date();
  const week = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  return Array.from({ length: 10 }).map((_, i) => {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    return {
      key: d.toISOString().slice(0, 10),
      weekday: week[d.getDay()],
      day: d.getDate(),
      month: d.toLocaleString("pt-BR", { month: "short" }).replace(".", ""),
      full: d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" }),
    };
  });
}

function Index() {
  const days = useMemo(buildDays, []);
  const [serviceId, setServiceId] = useState<string>(services[0].id);
  const [dayKey, setDayKey] = useState<string>(days[1].key);
  const [time, setTime] = useState<string | null>("10:00");
  const [step, setStep] = useState<1 | 2>(1);

  const service = services.find((s) => s.id === serviceId)!;
  const day = days.find((d) => d.key === dayKey)!;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-[440px] px-6 pb-40 pt-8">
        {/* Brand */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-primary" />
            <span className="text-xs font-medium tracking-[0.22em] text-muted-foreground">
              AURA
            </span>
          </div>
          <button
            type="button"
            className="rounded-full border border-border/70 px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition hover:text-foreground"
          >
            Minha conta
          </button>
        </header>

        {/* Hero */}
        <section className="mt-10">
          <div className="relative overflow-hidden rounded-[28px] bg-secondary">
            <img
              src={heroImg}
              alt=""
              width={1024}
              height={1280}
              className="h-56 w-full object-cover"
            />
          </div>
          <div className="mt-6 flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-accent/40 font-display text-lg text-foreground">
              M
            </div>
            <div className="min-w-0">
              <h1 className="text-[26px] leading-tight font-light">
                Marina Bastos
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Lash Designer · Studio Jardins, SP
              </p>
            </div>
          </div>
          <p className="mt-5 text-[15px] leading-relaxed text-muted-foreground">
            Reserve seu horário em segundos. Você recebe confirmação, lembretes
            e todo o cuidado do estúdio direto no seu celular.
          </p>
        </section>

        {/* Stepper */}
        <nav className="mt-10 flex items-center gap-3 text-[11px] tracking-[0.18em] text-muted-foreground">
          <button
            onClick={() => setStep(1)}
            className={`transition ${step === 1 ? "text-foreground" : ""}`}
          >
            01 · SERVIÇO
          </button>
          <span className="h-px flex-1 bg-border" />
          <button
            onClick={() => setStep(2)}
            className={`transition ${step === 2 ? "text-foreground" : ""}`}
          >
            02 · HORÁRIO
          </button>
        </nav>

        {step === 1 && (
          <section className="mt-8 space-y-3">
            {services.map((s) => {
              const active = s.id === serviceId;
              return (
                <button
                  key={s.id}
                  onClick={() => setServiceId(s.id)}
                  className={`group w-full rounded-2xl border p-5 text-left transition-all duration-300 ${
                    active
                      ? "border-foreground/80 bg-foreground text-background shadow-[0_10px_40px_-20px_rgba(0,0,0,0.35)]"
                      : "border-border/70 bg-card hover:border-foreground/30"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-base font-medium">{s.name}</h3>
                      <p
                        className={`mt-1 text-xs ${
                          active ? "text-background/60" : "text-muted-foreground"
                        }`}
                      >
                        {s.duration}
                        {s.note ? ` · ${s.note}` : ""}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-medium">{s.price}</span>
                  </div>
                </button>
              );
            })}

            <button
              onClick={() => setStep(2)}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-foreground py-4 text-sm font-medium text-background transition-transform active:scale-[0.98]"
            >
              Escolher horário
              <span aria-hidden>→</span>
            </button>
          </section>
        )}

        {step === 2 && (
          <section className="mt-8">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Escolha o dia
            </p>
            <div className="mt-3 -mx-6 overflow-x-auto px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div className="flex gap-2">
                {days.map((d) => {
                  const active = d.key === dayKey;
                  return (
                    <button
                      key={d.key}
                      onClick={() => setDayKey(d.key)}
                      className={`flex min-w-[64px] flex-col items-center rounded-2xl border px-3 py-3 transition ${
                        active
                          ? "border-foreground bg-foreground text-background"
                          : "border-border/70 bg-card text-foreground hover:border-foreground/40"
                      }`}
                    >
                      <span className="text-[10px] uppercase tracking-widest opacity-70">
                        {d.weekday}
                      </span>
                      <span className="mt-1 font-display text-xl leading-none">
                        {d.day}
                      </span>
                      <span className="mt-1 text-[10px] uppercase opacity-60">
                        {d.month}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <p className="mt-8 text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Horários disponíveis
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {times.map((t) => {
                const active = t === time;
                return (
                  <button
                    key={t}
                    onClick={() => setTime(t)}
                    className={`rounded-xl border py-3 text-sm font-medium transition ${
                      active
                        ? "border-foreground bg-foreground text-background"
                        : "border-border/70 bg-card hover:border-foreground/40"
                    }`}
                  >
                    {t}
                  </button>
                );
              })}
            </div>

            {/* Summary */}
            <div className="mt-10 rounded-3xl border border-border/70 bg-secondary/60 p-5">
              <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-muted-foreground">
                <span>Resumo</span>
                <span>Confirmação por SMS</span>
              </div>
              <div className="mt-4 space-y-3 text-sm">
                <Row label="Serviço" value={service.name} />
                <Row label="Duração" value={service.duration} />
                <Row
                  label="Quando"
                  value={`${day.full}${time ? ` · ${time}` : ""}`}
                />
                <div className="my-3 h-px bg-border" />
                <Row label="Total" value={service.price} strong />
                <p className="pt-1 text-[11px] text-muted-foreground">
                  Taxa de reserva opcional via PIX definida pela profissional.
                </p>
              </div>
            </div>
          </section>
        )}
      </div>

      {/* Sticky action bar */}
      {step === 2 && (
        <div className="fixed inset-x-0 bottom-0 border-t border-border/70 bg-background/85 px-6 pb-8 pt-4 backdrop-blur-xl">
          <div className="mx-auto flex max-w-[440px] items-center gap-3">
            <button
              onClick={() => setStep(1)}
              className="rounded-full border border-border/70 px-5 py-3 text-sm text-muted-foreground transition hover:text-foreground"
            >
              Voltar
            </button>
            <button
              disabled={!time}
              className="flex-1 rounded-full bg-foreground py-3.5 text-sm font-medium text-background transition disabled:opacity-40"
            >
              Confirmar reserva
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

function Row({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-xs uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <span className={strong ? "font-display text-lg" : "text-foreground"}>
        {value}
      </span>
    </div>
  );
}
