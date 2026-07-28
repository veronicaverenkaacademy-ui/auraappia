import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
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
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [payMethod, setPayMethod] = useState<"pix" | "card" | "later">("pix");
  const [otpSent, setOtpSent] = useState(false);
  const navigate = useNavigate();

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
        <nav className="mt-10 flex items-center gap-2 text-[10px] tracking-[0.18em] text-muted-foreground">
          {[
            [1, "SERVIÇO"],
            [2, "HORÁRIO"],
            [3, "IDENTIFICAR"],
            [4, "CONFIRMAR"],
          ].map(([n, label], i, arr) => (
            <div key={n as number} className="flex flex-1 items-center gap-2">
              <button
                onClick={() => n === 5 ? null : setStep(n as 1 | 2 | 3 | 4)}
                className={`whitespace-nowrap transition ${
                  (step as number) >= (n as number) ? "text-foreground" : ""
                }`}
              >
                {String(n).padStart(2, "0")} · {label}
              </button>
              {i < arr.length - 1 && <span className="h-px flex-1 bg-border" />}
            </div>
          ))}
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

        {step === 3 && (
          <section className="mt-8 space-y-5">
            <div>
              <h2 className="text-[22px] font-light leading-tight">Só falta você</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Vamos identificar você para enviar confirmação e lembretes no WhatsApp.
              </p>
            </div>

            <div className="space-y-3">
              <Field label="Nome completo" value={name} onChange={setName} placeholder="Como você se chama?" />
              <Field label="WhatsApp" value={phone} onChange={setPhone} placeholder="(00) 00000-0000" inputMode="tel" />
              <Field label="E-mail (opcional)" value={email} onChange={setEmail} placeholder="voce@email.com" inputMode="email" />
            </div>

            {!otpSent ? (
              <button
                disabled={name.trim().length < 3 || phone.replace(/\D/g, "").length < 10}
                onClick={() => setOtpSent(true)}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-foreground py-4 text-sm font-medium text-background transition disabled:opacity-40"
              >
                Receber código no WhatsApp
              </button>
            ) : (
              <div className="space-y-3 rounded-3xl border border-border/70 bg-secondary/60 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Código enviado</p>
                <p className="text-sm text-muted-foreground">
                  Enviamos um código de 6 dígitos para <span className="text-foreground">{phone}</span>.
                </p>
                <input
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  inputMode="numeric"
                  className="w-full rounded-2xl border border-border/60 bg-background px-4 py-3 text-center font-display text-2xl tracking-[0.4em] outline-none focus:border-foreground/50"
                />
                <button
                  disabled={otp.length !== 6}
                  onClick={() => setStep(4)}
                  className="flex w-full items-center justify-center gap-2 rounded-full bg-foreground py-3.5 text-sm font-medium text-background transition disabled:opacity-40"
                >
                  Verificar e continuar
                </button>
                <button
                  onClick={() => setOtpSent(false)}
                  className="w-full py-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  Alterar número
                </button>
              </div>
            )}

            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">ou entre com</span>
              <span className="h-px flex-1 bg-border" />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <SocialBtn onClick={() => setStep(4)} label="Google" />
              <SocialBtn onClick={() => setStep(4)} label="Apple" />
            </div>

            <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
              Ao continuar você concorda com nossos termos e a política de privacidade (LGPD).
            </p>
          </section>
        )}

        {step === 4 && (
          <section className="mt-8 space-y-5">
            <div>
              <h2 className="text-[22px] font-light leading-tight">Confirmar reserva</h2>
              <p className="mt-2 text-sm text-muted-foreground">Revise os detalhes antes de finalizar.</p>
            </div>

            <div className="rounded-3xl border border-border/70 bg-secondary/60 p-5">
              <div className="space-y-3 text-sm">
                <Row label="Cliente" value={name || "—"} />
                <Row label="Serviço" value={service.name} />
                <Row label="Profissional" value="Marina Bastos" />
                <Row label="Quando" value={`${day.full}${time ? ` · ${time}` : ""}`} />
                <Row label="Duração" value={service.duration} />
                <div className="my-3 h-px bg-border" />
                <Row label="Total" value={service.price} strong />
              </div>
            </div>

            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Taxa de reserva</p>
              <div className="mt-3 space-y-2">
                {[
                  { id: "pix", label: "PIX (sinal R$ 30)", desc: "Confirma imediatamente" },
                  { id: "card", label: "Cartão", desc: "Débito ou crédito" },
                  { id: "later", label: "Pagar no local", desc: "Sem sinal" },
                ].map((opt) => {
                  const active = payMethod === (opt.id as typeof payMethod);
                  return (
                    <button
                      key={opt.id}
                      onClick={() => setPayMethod(opt.id as typeof payMethod)}
                      className={`flex w-full items-center justify-between rounded-2xl border p-4 text-left transition ${
                        active ? "border-foreground bg-foreground text-background" : "border-border/70 bg-card hover:border-foreground/30"
                      }`}
                    >
                      <div>
                        <p className="text-sm font-medium">{opt.label}</p>
                        <p className={`mt-0.5 text-xs ${active ? "text-background/60" : "text-muted-foreground"}`}>
                          {opt.desc}
                        </p>
                      </div>
                      <span className={`h-4 w-4 rounded-full border ${active ? "border-background bg-background" : "border-border"}`} />
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              onClick={() => setStep(5)}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-full bg-foreground py-4 text-sm font-medium text-background transition-transform active:scale-[0.98]"
            >
              Confirmar agendamento
            </button>
          </section>
        )}

        {step === 5 && (
          <section className="mt-10 space-y-6 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-foreground text-2xl text-background">
              ✓
            </div>
            <div>
              <h2 className="text-[24px] font-light leading-tight">Reserva confirmada</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Enviamos os detalhes no seu WhatsApp. Nos vemos {day.full.toLowerCase()} às {time}.
              </p>
            </div>
            <div className="rounded-3xl border border-border/70 bg-secondary/60 p-5 text-left">
              <Row label="Código" value="#AURA-4821" />
              <Row label="Serviço" value={service.name} />
              <Row label="Total" value={service.price} strong />
            </div>
            <button
              onClick={() => navigate({ to: "/portal" })}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-foreground py-4 text-sm font-medium text-background"
            >
              Ver minha área
            </button>
            <Link to="/" className="block text-xs text-muted-foreground hover:text-foreground">
              Voltar ao início
            </Link>
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
              onClick={() => setStep(3)}
              className="flex-1 rounded-full bg-foreground py-3.5 text-sm font-medium text-background transition disabled:opacity-40"
            >
              Confirmar reserva
            </button>
          </div>
        </div>
      )}

      {/* Discreet returning-client login */}
      {step < 3 && (
        <div className="fixed bottom-4 right-4 z-10">
          <Link
            to="/portal"
            className="rounded-full border border-border/70 bg-background/80 px-4 py-2 text-[11px] font-medium text-muted-foreground backdrop-blur hover:text-foreground"
          >
            Já sou cliente
          </Link>
        </div>
      )}
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  inputMode?: "text" | "tel" | "email" | "numeric";
}) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        className="mt-1 w-full rounded-2xl border border-border/60 bg-background px-4 py-3.5 text-sm outline-none transition focus:border-foreground/50"
      />
    </label>
  );
}

function SocialBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-2xl border border-border/70 bg-card py-3 text-sm font-medium transition hover:border-foreground/40"
    >
      {label}
    </button>
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
