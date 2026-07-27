import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import {
  Bell,
  Calendar as CalIcon,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Coffee,
  Filter,
  Instagram,
  MessageCircle,
  Package,
  Phone,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  User,
  X,
  AlertTriangle,
  DollarSign,
  Gift,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/agenda")({
  head: () => ({
    meta: [
      { title: "Agenda — AURA" },
      { name: "description", content: "Agenda inteligente: o centro operacional do seu negócio." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Agenda,
});

// ---------- Types & mock data ----------
type Status = "scheduled" | "confirmed" | "waiting" | "cancelled" | "in_progress" | "done";

type Appt = {
  id: string;
  day: number; // offset from Monday 0..5
  start: number; // decimal hour
  duration: number; // hours
  name: string;
  service: string;
  price: number;
  status: Status;
  phone?: string;
  instagram?: string;
  avatar?: string;
};

type Marker = {
  day: number;
  at: number;
  kind: "confirm" | "stock" | "goal" | "birthday" | "cleaning" | "lunch";
  text: string;
};

const HOUR_H = 64;
const HOURS = Array.from({ length: 12 }, (_, i) => 8 + i); // 8..19

const STATUS: Record<Status, { label: string; dot: string; ring: string; bg: string }> = {
  scheduled: { label: "Agendado", dot: "bg-muted-foreground/60", ring: "border-border", bg: "bg-card" },
  confirmed: { label: "Confirmado", dot: "bg-success", ring: "border-success/30", bg: "bg-card" },
  waiting: { label: "Aguardando", dot: "bg-amber-500", ring: "border-amber-500/30", bg: "bg-amber-50/60 dark:bg-amber-500/5" },
  cancelled: { label: "Cancelado", dot: "bg-destructive", ring: "border-destructive/30", bg: "bg-card opacity-60" },
  in_progress: { label: "Em atendimento", dot: "bg-blue-500", ring: "border-blue-500/40", bg: "bg-blue-50/60 dark:bg-blue-500/5" },
  done: { label: "Concluído", dot: "bg-purple-500", ring: "border-purple-500/30", bg: "bg-card" },
};

const week: Appt[] = [
  { id: "a1", day: 1, start: 9, duration: 1.5, name: "Marina Costa", service: "Volume Brasileiro", price: 180, status: "in_progress", phone: "(11) 98765-4321", instagram: "@marinacosta" },
  { id: "a2", day: 1, start: 10.5, duration: 1.5, name: "Isabela Torres", service: "Volume Russo", price: 190, status: "confirmed", phone: "(11) 97777-1122" },
  { id: "a3", day: 1, start: 12, duration: 1, name: "Beatriz Almeida", service: "Manutenção", price: 170, status: "waiting", phone: "(11) 96666-3344" },
  { id: "a4", day: 1, start: 14.5, duration: 1.5, name: "Camila Lima", service: "Volume Brasileiro", price: 200, status: "confirmed" },
  { id: "a5", day: 1, start: 17.5, duration: 1, name: "Julia Mendes", service: "Volume Brasileiro", price: 180, status: "scheduled" },
  { id: "a6", day: 2, start: 10, duration: 1.5, name: "Ana Prado", service: "Design", price: 90, status: "confirmed" },
  { id: "a7", day: 2, start: 14, duration: 2, name: "Fernanda Luz", service: "Volume Brasileiro", price: 180, status: "scheduled" },
  { id: "a8", day: 3, start: 9, duration: 2.5, name: "Renata M.", service: "Volume Russo", price: 190, status: "confirmed" },
  { id: "a9", day: 3, start: 15, duration: 1, name: "Camila S.", service: "Manutenção", price: 170, status: "scheduled" },
  { id: "a10", day: 4, start: 11, duration: 2, name: "Laura V.", service: "Volume Brasileiro", price: 180, status: "confirmed" },
  { id: "a11", day: 5, start: 10, duration: 1, name: "Patricia N.", service: "Sobrancelhas", price: 90, status: "scheduled" },
  { id: "a12", day: 5, start: 14, duration: 2.5, name: "Tatiana B.", service: "Volume Russo", price: 190, status: "confirmed" },
];

const markers: Marker[] = [
  { day: 1, at: 8.5, kind: "confirm", text: "Enviar confirmação para Camila em 30 min" },
  { day: 1, at: 11.75, kind: "stock", text: "Adesivo atinge estoque mínimo após este atendimento" },
  { day: 1, at: 13.5, kind: "lunch", text: "Almoço · 30 min" },
  { day: 1, at: 14, kind: "goal", text: "Meta diária será atingida após o próximo serviço" },
  { day: 1, at: 15.5, kind: "cleaning", text: "Tempo insuficiente para limpeza entre 15:20 e 15:30" },
  { day: 1, at: 16.5, kind: "birthday", text: "Juliana faz aniversário amanhã" },
];

const waitlist = [
  { name: "Juliana Santos", tag: "VIP", meta: "23 dias sem vir", price: 180 },
  { name: "Larissa Mendes", tag: "Média", meta: "15 dias sem vir", price: 150 },
  { name: "Amanda Silva", tag: "Média", meta: "30 dias sem vir", price: 170 },
  { name: "Patricia Lima", tag: "Baixa", meta: "45 dias sem vir", price: 130 },
];

// ---------- Helpers ----------
const fmtBRL = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtHour = (h: number) => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;

function useNow() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

// ---------- Main ----------
type ViewMode = "day" | "week" | "list" | "timeline";

function Agenda() {
  const [view, setView] = useState<ViewMode>("day");
  const [dayOffset, setDayOffset] = useState(0); // for day view (in days from today)
  const [weekOffset, setWeekOffset] = useState(0);
  const [selected, setSelected] = useState<Appt | null>(null);

  const now = useNow();

  // Day-view target date
  const dayDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    return d;
  }, [dayOffset]);

  // Which weekday slot does today correspond to (0..5, Mon..Sat)
  const todayIdx = (new Date().getDay() + 6) % 7;

  // Appointments for the "day view" mapped from mocked weekday-1 (Tuesday)
  // We just show the "day 1" set as "today" for demo purposes.
  const todaysAppts = week.filter((a) => a.day === 1);
  const todaysMarkers = markers.filter((m) => m.day === 1);

  const revenueToday = todaysAppts.filter((a) => a.status !== "cancelled").reduce((s, a) => s + a.price, 0);
  const doneCount = todaysAppts.filter((a) => a.status === "done" || a.status === "in_progress").length;
  const occupancy = Math.round(
    (todaysAppts.reduce((s, a) => s + a.duration, 0) / HOURS.length) * 100
  );

  return (
    <AppShell
      hideTrigger
      title={
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Agenda</span>
        </div>
      }
      right={
        <>
          <Button variant="ghost" size="icon" className="rounded-full h-9 w-9">
            <Search className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="rounded-full h-9 w-9 relative">
            <Bell className="w-4 h-4" />
            <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-destructive" />
          </Button>
          <Button size="sm" className="rounded-full h-9 gap-1.5">
            <Plus className="w-4 h-4" /> <span className="hidden sm:inline">Novo</span>
          </Button>
        </>
      }
      className="flex flex-col pb-24 md:pb-0"
    >
      {/* Header block */}
      <div className="px-4 md:px-8 pt-4 pb-3 shrink-0">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-[0.18em]">
              {dayDate.toLocaleDateString("pt-BR", { weekday: "long" })}
            </p>
            <h1 className="text-3xl md:text-4xl font-display font-medium tracking-tight capitalize leading-tight">
              {dayDate.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
            </h1>
          </div>
          <div className="hidden md:flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={() => setDayOffset((d) => d - 1)}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="sm" className="h-8 rounded-full" onClick={() => setDayOffset(0)}>
              Hoje
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={() => setDayOffset((d) => d + 1)}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Resumo do dia */}
        <div className="mt-5 grid grid-cols-3 gap-3">
          <SummaryCard label="atendimentos" value={String(todaysAppts.length).padStart(2, "0")} />
          <SummaryCard label="ocupação" value={`${occupancy}%`} />
          <SummaryCard label="previsto" value={fmtBRL(revenueToday)} />
        </div>

        {/* View tabs */}
        <div className="mt-5 -mx-1 overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-1 px-1">
            {(["day", "week", "list", "timeline"] as ViewMode[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cn(
                  "px-3.5 h-8 rounded-full text-xs font-medium transition-all whitespace-nowrap",
                  view === v
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                )}
              >
                {v === "day" ? "Dia" : v === "week" ? "Semana" : v === "list" ? "Lista" : "Timeline"}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full">
                <Filter className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Body */}
      <main className="flex-1 overflow-auto px-4 md:px-8 pb-10 animate-fade-in">
        {view === "day" && (
          <DayView
            appts={todaysAppts}
            markers={todaysMarkers}
            now={now}
            isToday
            onSelect={setSelected}
          />
        )}
        {view === "week" && (
          <WeekView weekOffset={weekOffset} setWeekOffset={setWeekOffset} onSelect={setSelected} todayIdx={todayIdx} />
        )}
        {view === "list" && <ListView appts={todaysAppts} markers={todaysMarkers} onSelect={setSelected} />}
        {view === "timeline" && <ListView appts={todaysAppts} markers={todaysMarkers} onSelect={setSelected} dense />}

        {/* AI + Waitlist */}
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <AIStrip revenueToday={revenueToday} appts={todaysAppts.length} occupancy={occupancy} />
          <WaitlistCard />
        </div>
      </main>

      <AppointmentSheet appt={selected} onClose={() => setSelected(null)} />
    </AppShell>
  );
}

// ---------- Summary card ----------
function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-secondary/50 border border-border/40 px-3 py-3">
      <div className="text-lg md:text-xl font-display font-medium tabular-nums leading-none">{value}</div>
      <div className="mt-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

// ---------- Day view ----------
function DayView({
  appts,
  markers,
  now,
  isToday,
  onSelect,
}: {
  appts: Appt[];
  markers: Marker[];
  now: Date;
  isToday: boolean;
  onSelect: (a: Appt) => void;
}) {
  const nowH = now.getHours() + now.getMinutes() / 60;
  const showNow = isToday && nowH >= HOURS[0] && nowH <= HOURS[HOURS.length - 1] + 1;

  return (
    <div className="relative">
      <div className="grid grid-cols-[52px_1fr] gap-3">
        {/* Hour column */}
        <div className="relative">
          {HOURS.map((h) => (
            <div
              key={h}
              style={{ height: HOUR_H }}
              className="text-[10px] text-muted-foreground text-right pr-2 -translate-y-1.5 tabular-nums"
            >
              {String(h).padStart(2, "0")}:00
            </div>
          ))}
        </div>

        {/* Column */}
        <div className="relative" style={{ height: HOUR_H * HOURS.length }}>
          {/* Hour lines */}
          {HOURS.map((h, i) => (
            <div
              key={h}
              style={{ top: i * HOUR_H }}
              className="absolute inset-x-0 border-t border-border/40"
            />
          ))}

          {/* Now indicator */}
          {showNow && (
            <div
              style={{ top: (nowH - HOURS[0]) * HOUR_H }}
              className="absolute inset-x-0 z-30 pointer-events-none"
            >
              <div className="relative">
                <div className="absolute -left-1 -top-[5px] w-2.5 h-2.5 rounded-full bg-primary shadow-[0_0_0_4px_var(--background)]" />
                <div className="border-t-2 border-primary" />
                <div className="absolute -top-[10px] right-0 text-[10px] font-medium text-primary tabular-nums bg-background px-1.5">
                  {fmtHour(nowH)}
                </div>
              </div>
            </div>
          )}

          {/* Markers (contextual) */}
          {markers.map((m, i) => (
            <MarkerRow key={i} m={m} />
          ))}

          {/* Appointments */}
          {appts.map((a) => (
            <ApptCard key={a.id} a={a} onSelect={onSelect} />
          ))}

          {/* Free slots — subtle empty slot at bottom */}
          <div
            style={{ top: (16.5 - HOURS[0]) * HOUR_H + 2, height: HOUR_H - 4 }}
            className="absolute left-1 right-1 rounded-xl border border-dashed border-border/60 flex items-center justify-between px-4 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground transition cursor-pointer group"
          >
            <div>
              <div className="font-medium text-foreground/70 group-hover:text-foreground">16:30</div>
              <div className="text-[10px]">Horário livre · disponível para encaixe</div>
            </div>
            <Plus className="w-4 h-4" />
          </div>
        </div>
      </div>
    </div>
  );
}

function ApptCard({ a, onSelect }: { a: Appt; onSelect: (a: Appt) => void }) {
  const top = (a.start - HOURS[0]) * HOUR_H + 2;
  const height = a.duration * HOUR_H - 6;
  const s = STATUS[a.status];
  return (
    <button
      onClick={() => onSelect(a)}
      style={{ top, height }}
      className={cn(
        "absolute left-1 right-1 rounded-2xl border shadow-sm px-3.5 py-2.5 text-left overflow-hidden transition-all",
        "hover:shadow-md hover:-translate-y-[1px] active:translate-y-0",
        s.ring,
        s.bg
      )}
    >
      <div className="flex items-center gap-2">
        <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", s.dot)} />
        <span className="text-[10px] font-medium tabular-nums text-muted-foreground">
          {fmtHour(a.start)} · {Math.round(a.duration * 60)}min
        </span>
        {a.status === "in_progress" && (
          <span className="ml-auto text-[10px] font-medium text-blue-600 dark:text-blue-400">em andamento</span>
        )}
      </div>
      <div className="mt-1 flex items-start gap-3">
        <Avatar name={a.name} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{a.name}</div>
          <div className="text-xs text-muted-foreground truncate">{a.service}</div>
          <div className="text-xs font-medium tabular-nums mt-0.5">{fmtBRL(a.price)}</div>
        </div>
      </div>
    </button>
  );
}

function MarkerRow({ m }: { m: Marker }) {
  const top = (m.at - HOURS[0]) * HOUR_H + 2;
  const map = {
    confirm: { icon: Sparkles, tint: "text-primary" },
    stock: { icon: Package, tint: "text-amber-600 dark:text-amber-400" },
    goal: { icon: DollarSign, tint: "text-success" },
    birthday: { icon: Gift, tint: "text-pink-500" },
    cleaning: { icon: AlertTriangle, tint: "text-destructive" },
    lunch: { icon: Coffee, tint: "text-muted-foreground" },
  } as const;
  const { icon: Icon, tint } = map[m.kind];
  return (
    <div
      style={{ top, height: 22 }}
      className="absolute left-1 right-1 flex items-center gap-2 px-2 z-20 pointer-events-none"
    >
      <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-background/90 backdrop-blur border border-border/60 shadow-sm">
        <Icon className={cn("w-3 h-3", tint)} />
        <span className="text-[10px] font-medium text-foreground/80">{m.text}</span>
      </div>
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = name.split(" ").slice(0, 2).map((n) => n[0]).join("");
  return (
    <div className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center text-[11px] font-medium text-foreground/70 shrink-0">
      {initials}
    </div>
  );
}

// ---------- Week view ----------
function WeekView({
  weekOffset,
  setWeekOffset,
  onSelect,
  todayIdx,
}: {
  weekOffset: number;
  setWeekOffset: (fn: (n: number) => number) => void;
  onSelect: (a: Appt) => void;
  todayIdx: number;
}) {
  const days = useMemo(() => {
    const start = new Date();
    const dow = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - dow + weekOffset * 7);
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [weekOffset]);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs text-muted-foreground capitalize">
          {days[0].toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} —{" "}
          {days[days.length - 1].toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full" onClick={() => setWeekOffset((n) => n - 1)}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full" onClick={() => setWeekOffset((n) => n + 1)}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="overflow-auto -mx-4 md:-mx-8 px-4 md:px-8">
        <div className="min-w-[720px]">
          <div className="grid grid-cols-[48px_repeat(6,1fr)] gap-2 mb-2 sticky top-0 bg-background z-10 pb-2">
            <div />
            {days.map((d, i) => {
              const isToday = weekOffset === 0 && i === todayIdx;
              return (
                <div key={i} className="text-center">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    {d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "")}
                  </div>
                  <div className={cn(
                    "mt-1 mx-auto w-8 h-8 flex items-center justify-center rounded-full text-sm tabular-nums",
                    isToday ? "bg-primary text-primary-foreground font-medium" : ""
                  )}>
                    {d.getDate()}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-[48px_repeat(6,1fr)] gap-2">
            <div className="relative">
              {HOURS.map((h) => (
                <div key={h} style={{ height: HOUR_H }} className="text-[10px] text-muted-foreground text-right pr-2 -translate-y-1.5 tabular-nums">
                  {String(h).padStart(2, "0")}
                </div>
              ))}
            </div>
            {days.map((_, dayIdx) => {
              const dayAppts = week.filter((a) => a.day === dayIdx);
              return (
                <div key={dayIdx} className="relative rounded-2xl bg-secondary/30 border border-border/40" style={{ height: HOUR_H * HOURS.length }}>
                  {HOURS.slice(1).map((h) => (
                    <div key={h} style={{ top: (h - HOURS[0]) * HOUR_H }} className="absolute inset-x-0 border-t border-border/30" />
                  ))}
                  {dayAppts.map((a) => {
                    const s = STATUS[a.status];
                    return (
                      <button
                        key={a.id}
                        onClick={() => onSelect(a)}
                        style={{ top: (a.start - HOURS[0]) * HOUR_H + 2, height: a.duration * HOUR_H - 4 }}
                        className={cn(
                          "absolute inset-x-1 rounded-xl border px-2 py-1.5 text-left overflow-hidden shadow-sm hover:shadow-md hover:-translate-y-[1px] transition",
                          s.ring, s.bg
                        )}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className={cn("w-1 h-1 rounded-full", s.dot)} />
                          <span className="text-[10px] tabular-nums text-muted-foreground">{fmtHour(a.start)}</span>
                        </div>
                        <div className="text-[11px] font-medium truncate mt-0.5">{a.name}</div>
                        <div className="text-[10px] text-muted-foreground truncate">{a.service}</div>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- List / Timeline view ----------
function ListView({
  appts,
  markers,
  onSelect,
  dense,
}: {
  appts: Appt[];
  markers: Marker[];
  onSelect: (a: Appt) => void;
  dense?: boolean;
}) {
  // Merge appts + markers into single ordered stream
  type Row =
    | { type: "appt"; at: number; a: Appt }
    | { type: "marker"; at: number; m: Marker };
  const rows: Row[] = [
    ...appts.map<Row>((a) => ({ type: "appt", at: a.start, a })),
    ...markers.map<Row>((m) => ({ type: "marker", at: m.at, m })),
  ].sort((x, y) => x.at - y.at);

  return (
    <div className="max-w-2xl mx-auto">
      <div className="text-xs text-muted-foreground mb-3">Terça, {new Date().getDate()} de {new Date().toLocaleDateString("pt-BR", { month: "long" })}</div>
      <div className="relative pl-16">
        <div className="absolute left-[52px] top-1 bottom-1 w-px bg-border/60" />
        {rows.map((r, i) => (
          <div key={i} className="relative py-2">
            <div className="absolute left-0 top-3 text-[10px] tabular-nums text-muted-foreground w-11 text-right pr-3">
              {fmtHour(r.at)}
            </div>
            <div className="absolute left-[48px] top-4 w-2 h-2 rounded-full bg-background border-2 border-border" />
            {r.type === "appt" ? (
              <button
                onClick={() => onSelect(r.a)}
                className={cn(
                  "w-full text-left rounded-2xl border bg-card px-3 py-2.5 flex items-center gap-3 hover:shadow-md hover:-translate-y-[1px] transition",
                  STATUS[r.a.status].ring
                )}
              >
                <Avatar name={r.a.name} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{r.a.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{r.a.service}</div>
                </div>
                <div className="text-xs font-medium tabular-nums">{fmtBRL(r.a.price)}</div>
              </button>
            ) : (
              <div className={cn(
                "rounded-2xl border border-dashed border-border/70 bg-secondary/40 px-3 py-2 flex items-center gap-2",
                dense ? "py-1.5" : ""
              )}>
                <MarkerIcon kind={r.m.kind} />
                <span className="text-xs text-foreground/80">{r.m.text}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function MarkerIcon({ kind }: { kind: Marker["kind"] }) {
  const map = {
    confirm: { icon: Sparkles, tint: "text-primary" },
    stock: { icon: Package, tint: "text-amber-600 dark:text-amber-400" },
    goal: { icon: DollarSign, tint: "text-success" },
    birthday: { icon: Gift, tint: "text-pink-500" },
    cleaning: { icon: AlertTriangle, tint: "text-destructive" },
    lunch: { icon: Coffee, tint: "text-muted-foreground" },
  } as const;
  const { icon: Icon, tint } = map[kind];
  return <Icon className={cn("w-3.5 h-3.5", tint)} />;
}

// ---------- AI strip ----------
function AIStrip({ revenueToday, appts, occupancy }: { revenueToday: number; appts: number; occupancy: number }) {
  const tips = [
    `Você terá um intervalo de 40 min às 15h — ideal para encaixar uma manutenção.`,
    `Faturamento previsto hoje: ${fmtBRL(revenueToday + 140)} com um encaixe.`,
    `Ocupação de ${occupancy}% em ${appts} atendimentos — dia produtivo.`,
  ];
  return (
    <div className="rounded-3xl bg-ai-card text-ai-card-foreground p-5 relative overflow-hidden">
      <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-ai-glow/30 blur-3xl" />
      <div className="flex items-center gap-2 relative">
        <div className="w-7 h-7 rounded-full bg-ai-glow/40 flex items-center justify-center">
          <Sparkles className="w-3.5 h-3.5" />
        </div>
        <div className="text-xs uppercase tracking-[0.18em] opacity-70">AURA IA</div>
      </div>
      <ul className="mt-4 space-y-2.5 relative">
        {tips.map((t, i) => (
          <li key={i} className="text-sm leading-relaxed flex gap-2">
            <span className="opacity-40 mt-1">·</span>
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- Waitlist ----------
function WaitlistCard() {
  return (
    <div className="rounded-3xl border border-border/50 bg-card p-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Fila de encaixe</div>
          <div className="text-base font-display font-medium mt-0.5">4 clientes aguardando</div>
        </div>
        <Button variant="ghost" size="sm" className="rounded-full h-8 text-xs">Ver todas</Button>
      </div>
      <div className="mt-4 space-y-2">
        {waitlist.map((c) => (
          <div key={c.name} className="flex items-center gap-3 py-1.5">
            <Avatar name={c.name} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate flex items-center gap-2">
                {c.name}
                {c.tag === "VIP" && (
                  <span className="text-[9px] uppercase tracking-wider bg-accent/40 text-accent-foreground px-1.5 py-0.5 rounded-full">VIP</span>
                )}
              </div>
              <div className="text-[11px] text-muted-foreground">{c.meta} · {fmtBRL(c.price)}</div>
            </div>
            <Button size="sm" variant="outline" className="h-8 rounded-full text-xs">Oferecer</Button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Appointment Sheet ----------
function AppointmentSheet({ appt, onClose }: { appt: Appt | null; onClose: () => void }) {
  const open = !!appt;
  const a = appt;
  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
        {a && (
          <>
            <SheetHeader className="px-6 pt-6 pb-2">
              <SheetTitle className="sr-only">{a.name}</SheetTitle>
              <div className="flex items-center justify-between">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  {fmtHour(a.start)} — {fmtHour(a.start + a.duration)}
                </div>
                <span className={cn(
                  "text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full",
                  a.status === "in_progress" && "bg-blue-500/10 text-blue-600 dark:text-blue-400",
                  a.status === "confirmed" && "bg-success/10 text-success",
                  a.status === "waiting" && "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                  a.status === "scheduled" && "bg-secondary text-muted-foreground",
                  a.status === "cancelled" && "bg-destructive/10 text-destructive",
                  a.status === "done" && "bg-purple-500/10 text-purple-600 dark:text-purple-400"
                )}>
                  {STATUS[a.status].label}
                </span>
              </div>

              <div className="mt-3 flex items-center gap-3">
                <div className="w-14 h-14 rounded-full bg-secondary flex items-center justify-center text-sm font-medium">
                  {a.name.split(" ").slice(0, 2).map((n) => n[0]).join("")}
                </div>
                <div className="min-w-0">
                  <div className="text-xl font-display font-medium truncate">{a.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{a.service}</div>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-4 gap-2">
                <ActionBtn icon={Check} label="Confirmar" />
                <ActionBtn icon={RotateCcw} label="Remarcar" />
                <ActionBtn icon={X} label="Cancelar" />
                <ActionBtn icon={Copy} label="Mais" />
              </div>
            </SheetHeader>

            <div className="flex-1 overflow-auto px-6 py-4 space-y-4">
              <div className="space-y-2 text-sm">
                <Row icon={Phone} label={a.phone ?? "—"} extra={<MessageCircle className="w-4 h-4 text-success" />} />
                <Row icon={Instagram} label={a.instagram ?? "—"} />
                <Row icon={DollarSign} label="Valor total" right={fmtBRL(a.price)} />
                <Row icon={Clock} label="Tempo previsto" right={`${Math.round(a.duration * 60)} min`} />
                <Row icon={User} label="Protocolo" right={a.service} />
              </div>

              <div className="rounded-2xl border border-border/50 overflow-hidden">
                <div className="px-4 py-2.5 bg-secondary/40 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  Produtos utilizados
                </div>
                <div className="divide-y divide-border/40">
                  <ProductRow name="Fios 0.07D (Mix)" qty="0.15 usado" />
                  <ProductRow name="Adesivo Master" qty="1 gota" />
                  <ProductRow name="Pads Luxo" qty="1 unidade" />
                </div>
              </div>

              <div className="rounded-2xl border border-border/50 p-4">
                <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Observações</div>
                <div className="text-sm text-foreground/80">Cliente prefere efeito natural. Alergia leve a adesivos comuns — usar Master.</div>
              </div>
            </div>

            <div className="p-4 border-t border-border/50 bg-background">
              <Button className="w-full h-12 rounded-2xl gap-2 text-sm">
                <CheckCircle2 className="w-4 h-4" /> Concluir atendimento
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ActionBtn({ icon: Icon, label }: { icon: React.ComponentType<{ className?: string }>; label: string }) {
  return (
    <button className="flex flex-col items-center gap-1.5 py-2.5 rounded-2xl bg-secondary/60 hover:bg-secondary transition">
      <Icon className="w-4 h-4" />
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  );
}

function Row({
  icon: Icon,
  label,
  right,
  extra,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  right?: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
      <span className="flex-1 truncate">{label}</span>
      {right && <span className="text-muted-foreground tabular-nums">{right}</span>}
      {extra}
    </div>
  );
}

function ProductRow({ name, qty }: { name: string; qty: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 text-sm">
      <span>{name}</span>
      <span className="text-muted-foreground text-xs">{qty}</span>
    </div>
  );
}
