import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import {
  Ban,
  Bell,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  DollarSign,
  Filter,
  Loader2,
  Pencil,
  Phone,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  User,
  UserPlus,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DecimalInput } from "@/components/ui/decimal-input";
import { cn } from "@/lib/utils";
import {
  cancelAppointment,
  completeAppointment,
  confirmAppointment,
  createAppointment,
  createBlock,
  deleteBlock,
  findConflicts,
  formatBRL,
  getCompletionPreview,
  getRevertPreview,
  listAppointmentsRange,
  listBlocksRange,
  revertCompleted,
  updateAppointment,
  updateAppointmentTime,
  type MaterialAdjustment,
  type AgendaBlock,
  type Appointment,
  type AppointmentStatus,
  type ConflictItem,
} from "@/lib/agenda";
import { listClients, upsertClient, type Client } from "@/lib/clients";
import { listServices, type Service } from "@/lib/catalog";
import { listTeamMembers, type TeamMember } from "@/lib/team";
import { normalizePhoneBR } from "@/lib/phone";

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

// ---------- Constants ----------
const HOUR_H = 64;
const HOURS = Array.from({ length: 12 }, (_, i) => 8 + i); // 8..19

const STATUS: Record<AppointmentStatus, { label: string; dot: string; ring: string; bg: string; badge: string }> = {
  pending: { label: "Agendado", dot: "bg-muted-foreground/60", ring: "border-border", bg: "bg-card", badge: "bg-secondary text-muted-foreground" },
  confirmed: { label: "Confirmado", dot: "bg-success", ring: "border-success/30", bg: "bg-card", badge: "bg-success/10 text-success" },
  completed: { label: "Concluído", dot: "bg-purple-500", ring: "border-purple-500/30", bg: "bg-card", badge: "bg-purple-500/10 text-purple-600 dark:text-purple-400" },
  cancelled: { label: "Cancelado", dot: "bg-destructive", ring: "border-destructive/30", bg: "bg-card opacity-60", badge: "bg-destructive/10 text-destructive" },
  no_show: { label: "Não compareceu", dot: "bg-amber-500", ring: "border-amber-500/30", bg: "bg-amber-50/60 dark:bg-amber-500/5", badge: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
};

// ---------- Date/time helpers ----------
const fmtHour = (h: number) => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;
const hourOf = (iso: string) => { const d = new Date(iso); return d.getHours() + d.getMinutes() / 60; };
const toLocalDateStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const toLocalTimeStr = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const combineLocal = (dateStr: string, timeStr: string) => new Date(`${dateStr}T${timeStr}:00`);
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
function dayRangeISO(d: Date) {
  const from = new Date(d); from.setHours(0, 0, 0, 0);
  const to = new Date(from); to.setDate(to.getDate() + 1);
  return { fromISO: from.toISOString(), toISO: to.toISOString() };
}

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
type Selection = { type: "appointment"; data: Appointment } | { type: "block"; data: AgendaBlock } | null;
type FormOpen = { mode: "create" | "edit"; appointment?: Appointment; prefillStart?: Date } | null;

function Agenda() {
  const [view, setView] = useState<ViewMode>("day");
  const [dayOffset, setDayOffset] = useState(0);
  const [weekOffset, setWeekOffset] = useState(0);
  const [selection, setSelection] = useState<Selection>(null);
  const [formOpen, setFormOpen] = useState<FormOpen>(null);
  const [blockFormOpen, setBlockFormOpen] = useState<{ prefillStart?: Date } | null>(null);

  const now = useNow();
  const dayDate = useMemo(() => { const d = new Date(); d.setDate(d.getDate() + dayOffset); return d; }, [dayOffset]);
  const todayIdx = (new Date().getDay() + 6) % 7;

  const { fromISO: dFrom, toISO: dTo } = useMemo(() => dayRangeISO(dayDate), [dayDate]);
  const { data: dayAppts = [], isLoading: loadingDay } = useQuery({
    queryKey: ["appointments", dFrom, dTo],
    queryFn: () => listAppointmentsRange(dFrom, dTo),
  });
  const { data: dayBlocks = [] } = useQuery({
    queryKey: ["blocks", dFrom, dTo],
    queryFn: () => listBlocksRange(dFrom, dTo),
  });

  const { data: clients = [] } = useQuery({ queryKey: ["clients"], queryFn: listClients });
  const { data: services = [] } = useQuery({ queryKey: ["services"], queryFn: listServices });
  const { data: team = [] } = useQuery({ queryKey: ["team-members"], queryFn: listTeamMembers });
  const activeProfessionals = useMemo(() => team.filter((t) => t.status === "active"), [team]);

  const activeAppts = dayAppts.filter((a) => a.status !== "cancelled");
  const revenueToday = activeAppts.reduce((s, a) => s + Number(a.price), 0);
  const occupiedHours = activeAppts.reduce((s, a) => s + (new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime()) / 3_600_000, 0);
  const occupancy = Math.round((occupiedHours / HOURS.length) * 100);

  const openCreate = (prefillStart?: Date) => setFormOpen({ mode: "create", prefillStart });
  const openEdit = (appointment: Appointment) => { setSelection(null); setFormOpen({ mode: "edit", appointment }); };

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
          <Button variant="ghost" size="icon" className="rounded-full h-9 w-9" onClick={() => setBlockFormOpen({})} title="Bloquear horário">
            <Ban className="w-4 h-4" />
          </Button>
          <Button size="sm" className="rounded-full h-9 gap-1.5" onClick={() => openCreate()}>
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

        <div className="mt-5 grid grid-cols-3 gap-3">
          <SummaryCard label="atendimentos" value={String(activeAppts.length).padStart(2, "0")} />
          <SummaryCard label="ocupação" value={`${occupancy}%`} />
          <SummaryCard label="previsto" value={formatBRL(revenueToday)} />
        </div>

        <div className="mt-5 -mx-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex items-center gap-1 px-1">
            {(["day", "week", "list", "timeline"] as ViewMode[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cn(
                  "px-3.5 h-8 rounded-full text-xs font-medium transition-all whitespace-nowrap",
                  view === v ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground hover:bg-secondary/60",
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
            appts={dayAppts}
            blocks={dayBlocks}
            now={now}
            isToday={dayOffset === 0}
            loading={loadingDay}
            baseDate={dayDate}
            onSelectAppt={(a) => setSelection({ type: "appointment", data: a })}
            onSelectBlock={(b) => setSelection({ type: "block", data: b })}
            onCreateAt={(d) => openCreate(d)}
          />
        )}
        {view === "week" && (
          <WeekView
            weekOffset={weekOffset}
            setWeekOffset={setWeekOffset}
            todayIdx={todayIdx}
            onSelectAppt={(a) => setSelection({ type: "appointment", data: a })}
          />
        )}
        {view === "list" && (
          <ListView appts={dayAppts} blocks={dayBlocks} onSelectAppt={(a) => setSelection({ type: "appointment", data: a })} onSelectBlock={(b) => setSelection({ type: "block", data: b })} />
        )}
        {view === "timeline" && (
          <ListView appts={dayAppts} blocks={dayBlocks} onSelectAppt={(a) => setSelection({ type: "appointment", data: a })} onSelectBlock={(b) => setSelection({ type: "block", data: b })} dense />
        )}

        <div className="mt-6">
          <AIStrip revenueToday={revenueToday} appts={activeAppts.length} occupancy={occupancy} />
        </div>
      </main>

      <AppointmentDetailSheet
        appointment={selection?.type === "appointment" ? selection.data : null}
        onClose={() => setSelection(null)}
        onEdit={openEdit}
      />
      <BlockDetailSheet block={selection?.type === "block" ? selection.data : null} onClose={() => setSelection(null)} />

      {formOpen && (
        <AppointmentFormSheet
          mode={formOpen.mode}
          appointment={formOpen.appointment}
          prefillStart={formOpen.prefillStart}
          clients={clients}
          services={services}
          professionals={activeProfessionals}
          onClose={() => setFormOpen(null)}
        />
      )}
      {blockFormOpen && (
        <BlockFormSheet prefillStart={blockFormOpen.prefillStart} professionals={activeProfessionals} onClose={() => setBlockFormOpen(null)} />
      )}
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
  appts, blocks, now, isToday, loading, baseDate, onSelectAppt, onSelectBlock, onCreateAt,
}: {
  appts: Appointment[];
  blocks: AgendaBlock[];
  now: Date;
  isToday: boolean;
  loading: boolean;
  baseDate: Date;
  onSelectAppt: (a: Appointment) => void;
  onSelectBlock: (b: AgendaBlock) => void;
  onCreateAt: (d: Date) => void;
}) {
  const nowH = now.getHours() + now.getMinutes() / 60;
  const showNow = isToday && nowH >= HOURS[0] && nowH <= HOURS[HOURS.length - 1] + 1;

  const handleColumnClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    const rawHour = HOURS[0] + offsetY / HOUR_H;
    const snapped = Math.max(HOURS[0], Math.min(HOURS[HOURS.length - 1] + 0.75, Math.round(rawHour * 4) / 4));
    const d = new Date(baseDate);
    d.setHours(Math.floor(snapped), Math.round((snapped % 1) * 60), 0, 0);
    onCreateAt(d);
  };

  return (
    <div className="relative">
      <div className="grid grid-cols-[52px_1fr] gap-3">
        <div className="relative">
          {HOURS.map((h) => (
            <div key={h} style={{ height: HOUR_H }} className="text-[10px] text-muted-foreground text-right pr-2 -translate-y-1.5 tabular-nums">
              {String(h).padStart(2, "0")}:00
            </div>
          ))}
        </div>

        <div className="relative cursor-cell" style={{ height: HOUR_H * HOURS.length }} onClick={handleColumnClick}>
          {HOURS.map((h, i) => (
            <div key={h} style={{ top: i * HOUR_H }} className="absolute inset-x-0 border-t border-border/40 pointer-events-none" />
          ))}

          {showNow && (
            <div style={{ top: (nowH - HOURS[0]) * HOUR_H }} className="absolute inset-x-0 z-30 pointer-events-none">
              <div className="relative">
                <div className="absolute -left-1 -top-[5px] w-2.5 h-2.5 rounded-full bg-primary shadow-[0_0_0_4px_var(--background)]" />
                <div className="border-t-2 border-primary" />
                <div className="absolute -top-[10px] right-0 text-[10px] font-medium text-primary tabular-nums bg-background px-1.5">
                  {fmtHour(nowH)}
                </div>
              </div>
            </div>
          )}

          {loading && (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground pointer-events-none">
              Carregando agenda…
            </div>
          )}

          {blocks.map((b) => <BlockBar key={b.id} b={b} onSelect={onSelectBlock} />)}
          {appts.map((a) => <ApptCard key={a.id} a={a} onSelect={onSelectAppt} />)}
        </div>
      </div>
    </div>
  );
}

function ApptCard({ a, onSelect }: { a: Appointment; onSelect: (a: Appointment) => void }) {
  const start = hourOf(a.starts_at);
  const end = hourOf(a.ends_at);
  const top = (start - HOURS[0]) * HOUR_H + 2;
  const height = Math.max(30, (end - start) * HOUR_H - 6);
  const s = STATUS[a.status];
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onSelect(a); }}
      style={{ top, height }}
      className={cn(
        "absolute left-1 right-1 rounded-2xl border shadow-sm px-3.5 py-2.5 text-left overflow-hidden transition-all",
        "hover:shadow-md hover:-translate-y-[1px] active:translate-y-0",
        s.ring,
        s.bg,
      )}
    >
      <div className="flex items-center gap-2">
        <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", s.dot)} />
        <span className="text-[10px] font-medium tabular-nums text-muted-foreground">
          {fmtHour(start)} · {Math.round((end - start) * 60)}min
        </span>
        {a.professional?.full_name && (
          <span className="ml-auto text-[10px] text-muted-foreground truncate max-w-[90px]">{a.professional.full_name}</span>
        )}
      </div>
      <div className="mt-1 flex items-start gap-3">
        <Avatar name={a.client?.full_name ?? "Cliente"} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{a.client?.full_name ?? "Cliente"}</div>
          <div className="text-xs text-muted-foreground truncate">{a.service_name ?? a.service?.name ?? "Atendimento"}</div>
          <div className="text-xs font-medium tabular-nums mt-0.5">{formatBRL(Number(a.price))}</div>
        </div>
      </div>
    </button>
  );
}

function BlockBar({ b, onSelect }: { b: AgendaBlock; onSelect: (b: AgendaBlock) => void }) {
  const start = hourOf(b.starts_at);
  const end = hourOf(b.ends_at);
  const top = (start - HOURS[0]) * HOUR_H + 2;
  const height = Math.max(26, (end - start) * HOUR_H - 6);
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onSelect(b); }}
      style={{ top, height }}
      className="absolute left-1 right-1 rounded-2xl border border-dashed border-muted-foreground/40 bg-secondary/60 px-3.5 py-2 text-left flex items-center gap-2 text-muted-foreground hover:border-muted-foreground/60 transition"
    >
      <Ban className="w-3.5 h-3.5 shrink-0" />
      <div className="min-w-0">
        <div className="text-xs font-medium truncate">{b.reason || "Horário bloqueado"}</div>
        <div className="text-[10px] tabular-nums">
          {fmtHour(start)}–{fmtHour(end)}{b.professional?.full_name ? ` · ${b.professional.full_name}` : ""}
        </div>
      </div>
    </button>
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
  weekOffset, setWeekOffset, onSelectAppt, todayIdx,
}: {
  weekOffset: number;
  setWeekOffset: (fn: (n: number) => number) => void;
  onSelectAppt: (a: Appointment) => void;
  todayIdx: number;
}) {
  const days = useMemo(() => {
    const start = new Date();
    const dow = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - dow + weekOffset * 7);
    start.setHours(0, 0, 0, 0);
    return Array.from({ length: 6 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  }, [weekOffset]);

  const fromISO = useMemo(() => days[0].toISOString(), [days]);
  const toISO = useMemo(() => { const d = new Date(days[days.length - 1]); d.setDate(d.getDate() + 1); return d.toISOString(); }, [days]);
  const { data: appts = [] } = useQuery({ queryKey: ["appointments", fromISO, toISO], queryFn: () => listAppointmentsRange(fromISO, toISO) });

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
                  <div className={cn("mt-1 mx-auto w-8 h-8 flex items-center justify-center rounded-full text-sm tabular-nums", isToday ? "bg-primary text-primary-foreground font-medium" : "")}>
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
            {days.map((day, dayIdx) => {
              const dayAppts = appts.filter((a) => sameDay(new Date(a.starts_at), day));
              return (
                <div key={dayIdx} className="relative rounded-2xl bg-secondary/30 border border-border/40" style={{ height: HOUR_H * HOURS.length }}>
                  {HOURS.slice(1).map((h) => (
                    <div key={h} style={{ top: (h - HOURS[0]) * HOUR_H }} className="absolute inset-x-0 border-t border-border/30" />
                  ))}
                  {dayAppts.map((a) => {
                    const start = hourOf(a.starts_at);
                    const end = hourOf(a.ends_at);
                    const s = STATUS[a.status];
                    return (
                      <button
                        key={a.id}
                        onClick={() => onSelectAppt(a)}
                        style={{ top: (start - HOURS[0]) * HOUR_H + 2, height: Math.max(24, (end - start) * HOUR_H - 4) }}
                        className={cn("absolute inset-x-1 rounded-xl border px-2 py-1.5 text-left overflow-hidden shadow-sm hover:shadow-md hover:-translate-y-[1px] transition", s.ring, s.bg)}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className={cn("w-1 h-1 rounded-full", s.dot)} />
                          <span className="text-[10px] tabular-nums text-muted-foreground">{fmtHour(start)}</span>
                        </div>
                        <div className="text-[11px] font-medium truncate mt-0.5">{a.client?.full_name ?? "Cliente"}</div>
                        <div className="text-[10px] text-muted-foreground truncate">{a.service_name ?? "Atendimento"}</div>
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
  appts, blocks, onSelectAppt, onSelectBlock, dense,
}: {
  appts: Appointment[];
  blocks: AgendaBlock[];
  onSelectAppt: (a: Appointment) => void;
  onSelectBlock: (b: AgendaBlock) => void;
  dense?: boolean;
}) {
  type Row = { at: number } & ({ kind: "appt"; a: Appointment } | { kind: "block"; b: AgendaBlock });
  const rows: Row[] = [
    ...appts.map<Row>((a) => ({ kind: "appt", at: hourOf(a.starts_at), a })),
    ...blocks.map<Row>((b) => ({ kind: "block", at: hourOf(b.starts_at), b })),
  ].sort((x, y) => x.at - y.at);

  return (
    <div className="max-w-2xl mx-auto">
      {rows.length === 0 ? (
        <div className="text-center text-sm text-muted-foreground py-10">Nenhum agendamento neste dia.</div>
      ) : (
        <div className="relative pl-16">
          <div className="absolute left-[52px] top-1 bottom-1 w-px bg-border/60" />
          {rows.map((r, i) => (
            <div key={i} className="relative py-2">
              <div className="absolute left-0 top-3 text-[10px] tabular-nums text-muted-foreground w-11 text-right pr-3">{fmtHour(r.at)}</div>
              <div className="absolute left-[48px] top-4 w-2 h-2 rounded-full bg-background border-2 border-border" />
              {r.kind === "appt" ? (
                <button
                  onClick={() => onSelectAppt(r.a)}
                  className={cn("w-full text-left rounded-2xl border bg-card px-3 py-2.5 flex items-center gap-3 hover:shadow-md hover:-translate-y-[1px] transition", STATUS[r.a.status].ring)}
                >
                  <Avatar name={r.a.client?.full_name ?? "Cliente"} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{r.a.client?.full_name ?? "Cliente"}</div>
                    <div className="text-xs text-muted-foreground truncate">{r.a.service_name ?? "Atendimento"}</div>
                  </div>
                  <div className="text-xs font-medium tabular-nums">{formatBRL(Number(r.a.price))}</div>
                </button>
              ) : (
                <button
                  onClick={() => onSelectBlock(r.b)}
                  className={cn("w-full text-left rounded-2xl border border-dashed border-muted-foreground/40 bg-secondary/40 px-3 py-2 flex items-center gap-2", dense ? "py-1.5" : "")}
                >
                  <Ban className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="text-xs text-foreground/80">{r.b.reason || "Horário bloqueado"}</span>
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- AI strip (só números reais, nada fabricado) ----------
function AIStrip({ revenueToday, appts, occupancy }: { revenueToday: number; appts: number; occupancy: number }) {
  return (
    <div className="rounded-3xl bg-ai-card text-ai-card-foreground p-5 relative overflow-hidden">
      <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-ai-glow/30 blur-3xl" />
      <div className="flex items-center gap-2 relative">
        <div className="w-7 h-7 rounded-full bg-ai-glow/40 flex items-center justify-center">
          <Sparkles className="w-3.5 h-3.5" />
        </div>
        <div className="text-xs uppercase tracking-[0.18em] opacity-70">Resumo do dia</div>
      </div>
      <div className="mt-4 text-sm leading-relaxed relative">
        {appts === 0 ? (
          <p>Nenhum atendimento hoje ainda.</p>
        ) : (
          <p>
            Ocupação de {occupancy}% em {appts} atendimento{appts === 1 ? "" : "s"} hoje. Faturamento previsto: {formatBRL(revenueToday)}.
          </p>
        )}
      </div>
    </div>
  );
}

// ---------- Form primitives ----------
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground font-normal">{label}</Label>
      {children}
    </div>
  );
}

function Row({ icon: Icon, label, right }: { icon: React.ComponentType<{ className?: string }>; label: string; right?: string }) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
      <span className="flex-1 truncate">{label}</span>
      {right && <span className="text-muted-foreground tabular-nums">{right}</span>}
    </div>
  );
}

function ActionBtn({
  icon: Icon, label, onClick, disabled,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled} className="flex flex-col items-center gap-1.5 py-2.5 rounded-2xl bg-secondary/60 hover:bg-secondary transition disabled:opacity-40 disabled:pointer-events-none">
      <Icon className="w-4 h-4" />
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  );
}

// ---------- Client picker (busca real em clients + criação rápida inline) ----------
//
// Importante: NÃO usar o componente `cmdk` (Command/CommandEmpty) aqui. `CommandEmpty`
// desmonta a própria árvore (`return null`) sempre que seu estado interno de filtro
// recalcula — o que acontece a cada re-render do componente pai (ex.: lista de clientes
// chegando do Supabase, relógio da Agenda batendo minuto). Um mini-formulário com estado
// próprio (nome/telefone) e envio assíncrono dentro dessa árvore condicional pode ser
// desmontado no meio da interação, apagando o texto digitado ou interrompendo o clique
// entre o mousedown e o click — sem lançar nenhuma exceção. Por isso a lista + criação
// aqui são só React state simples, sem nenhuma lib de terceiros controlando montagem.
function ClientPicker({
  clients, value, onChange,
}: {
  clients: Client[];
  value: string;
  onChange: (id: string, name: string) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const selected = clients.find((c) => c.id === value);

  const filteredClients = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) => c.full_name.toLowerCase().includes(q) || (c.phone ?? "").includes(q));
  }, [clients, search]);

  const create = useMutation({
    mutationFn: () => upsertClient({ full_name: newName.trim(), phone: newPhone.trim() ? normalizePhoneBR(newPhone) : null }),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ["clients"] });
      onChange(c.id, c.full_name);
      toast.success("Cliente cadastrada");
      setCreating(false); setOpen(false); setNewName(""); setNewPhone(""); setSearch(""); setCreateError(null);
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : "Erro ao cadastrar cliente";
      setCreateError(msg);
      toast.error(msg);
    },
  });

  const startCreating = () => { setCreateError(null); setNewName(search); setCreating(true); };

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setCreating(false); setCreateError(null); } }}>
      <PopoverTrigger asChild>
        <button type="button" className="w-full h-11 rounded-xl bg-secondary px-3 text-left text-sm flex items-center justify-between">
          <span className={selected ? "" : "text-muted-foreground"}>{selected ? selected.full_name : "Selecionar cliente"}</span>
          <User className="w-4 h-4 text-muted-foreground shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px]" align="start">
        {!creating ? (
          <div className="space-y-2">
            <Input placeholder="Buscar cliente…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9" autoFocus />
            <div className="max-h-56 overflow-y-auto -mx-1 px-1">
              {filteredClients.length === 0 ? (
                <div className="py-4 text-center text-xs text-muted-foreground">Nenhuma cliente encontrada.</div>
              ) : (
                filteredClients.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => { onChange(c.id, c.full_name); setOpen(false); setSearch(""); }}
                    className="w-full text-left rounded-lg px-2 py-2 text-sm hover:bg-secondary transition"
                  >
                    {c.full_name}{c.phone ? ` · ${c.phone}` : ""}
                  </button>
                ))
              )}
            </div>
            <Button type="button" size="sm" variant="outline" className="w-full rounded-xl" onClick={startCreating}>
              <UserPlus className="w-3.5 h-3.5 mr-1.5" /> Criar nova cliente
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <Input placeholder="Nome completo" value={newName} onChange={(e) => setNewName(e.target.value)} className="h-9" autoFocus />
            <Input placeholder="Telefone (opcional)" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} className="h-9" />
            {createError && <p className="text-xs text-destructive">{createError}</p>}
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="ghost" className="flex-1 rounded-xl" onClick={() => { setCreating(false); setCreateError(null); }}>
                Voltar
              </Button>
              <Button
                type="button"
                size="sm"
                className="flex-1 rounded-xl"
                disabled={newName.trim().length < 2 || create.isPending}
                onClick={() => { setCreateError(null); create.mutate(); }}
              >
                {create.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Cadastrar e selecionar"}
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ---------- Conflict dialog ----------
function ConflictDialog({
  conflicts, open, onOpenChange, onConfirm, pending,
}: {
  conflicts: ConflictItem[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{conflicts.length > 1 ? "Esse horário conflita com outros compromissos" : "Esse horário conflita com outro compromisso"}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              <ul className="space-y-1">
                {conflicts.map((c) => (
                  <li key={c.id}>
                    {fmtHour(hourOf(c.starts_at))}–{fmtHour(hourOf(c.ends_at))} · {c.label}
                  </li>
                ))}
              </ul>
              <p>Deseja agendar mesmo assim?</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Não, escolher outro horário</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={pending}>
            {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Agendar mesmo assim"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ---------- Complete / revert confirm dialogs ----------
function CompleteConfirmDialog({
  appointment, open, onOpenChange, onDone,
}: {
  appointment: Appointment;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const { data: preview, isLoading, isError, error } = useQuery({
    queryKey: ["complete-preview", appointment.id, appointment.service_id, appointment.price],
    queryFn: () => getCompletionPreview(appointment.service_id, Number(appointment.price), appointment.id),
    enabled: open,
    retry: false,
  });

  // Quantidades editadas localmente (productId -> quantidade). Só gravamos um ajuste se
  // a profissional realmente mexer em algum campo — sem toque nenhum, usa a ficha técnica
  // padrão (ou o ajuste já salvo de uma conclusão anterior, se houver).
  const [edited, setEdited] = useState<Record<string, number>>({});
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (preview) {
      setEdited(Object.fromEntries(preview.materials.map((m) => [m.productId, m.quantity])));
      setTouched(false);
    }
  }, [preview]);

  const mut = useMutation({
    mutationFn: () => {
      const override: MaterialAdjustment[] | undefined = touched
        ? Object.entries(edited).map(([product_id, quantity]) => ({ product_id, quantity }))
        : undefined;
      return completeAppointment(appointment.id, override);
    },
    onSuccess: () => { toast.success("Atendimento concluído"); onOpenChange(false); onDone(); },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Erro ao concluir"),
  });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Concluir atendimento?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>Isso vai gerar uma receita de <strong className="text-foreground">{formatBRL(Number(appointment.price))}</strong> no Financeiro.</p>
              {isLoading ? (
                <p>Calculando consumo de estoque…</p>
              ) : isError ? (
                <p className="text-red-600">
                  Não deu pra calcular a prévia de consumo de estoque: {error instanceof Error ? error.message : String(error)}. Isso é só a prévia — o desconto de estoque em si (pela ficha técnica padrão) acontece do mesmo jeito ao concluir.
                </p>
              ) : preview && preview.materials.length > 0 ? (
                <div className="space-y-2">
                  <p>
                    E descontar do estoque {preview.isOverride && !touched ? "(ajuste salvo anteriormente para este atendimento)" : "— ajuste se o consumo real foi diferente"}:
                  </p>
                  <div className="space-y-2">
                    {preview.materials.map((m) => (
                      <div key={m.productId} className="flex items-center gap-2">
                        <span className="flex-1 text-foreground truncate">{m.productName}</span>
                        <DecimalInput
                          className="w-20 h-8 text-right"
                          value={edited[m.productId] ?? m.quantity}
                          onChange={(v) => {
                            setTouched(true);
                            setEdited((cur) => ({ ...cur, [m.productId]: v }));
                          }}
                        />
                        <span className="text-xs w-8 shrink-0">{m.unit}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p>Esse serviço não tem ficha técnica de materiais cadastrada — nenhum item de estoque será descontado.</p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Concluir e lançar"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function RevertConfirmDialog({
  appointment, open, onOpenChange, onDone,
}: {
  appointment: Appointment;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const { data: preview, isLoading } = useQuery({
    queryKey: ["revert-preview", appointment.id],
    queryFn: () => getRevertPreview(appointment.id),
    enabled: open,
  });
  const mut = useMutation({
    mutationFn: () => revertCompleted(appointment.id),
    onSuccess: () => { toast.success("Conclusão desfeita"); onOpenChange(false); onDone(); },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Erro ao desmarcar"),
  });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Desmarcar como concluído?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              {isLoading || !preview ? (
                <p>Calculando o que será revertido…</p>
              ) : (
                <>
                  <p>Isso vai reverter a receita de <strong className="text-foreground">{formatBRL(preview.revenueAmount)}</strong> lançada no Financeiro.</p>
                  {preview.consumedItems.length > 0 && (
                    <div>
                      <p>E devolver ao estoque:</p>
                      <ul className="list-disc pl-4">
                        {preview.consumedItems.map((m, i) => <li key={i}>{m.quantity} {m.unit} de {m.productName}</li>)}
                      </ul>
                    </div>
                  )}
                  <p>O agendamento volta para "Confirmado" e você poderá editar tudo de novo.</p>
                </>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Voltar</AlertDialogCancel>
          <AlertDialogAction onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Desmarcar conclusão"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ---------- Consumed products (real, só aparece em atendimentos concluídos) ----------
function ConsumedProducts({ appointmentId }: { appointmentId: string }) {
  const { data, isLoading } = useQuery({ queryKey: ["appointment-consumption", appointmentId], queryFn: () => getRevertPreview(appointmentId) });
  if (isLoading || !data || data.consumedItems.length === 0) return null;
  return (
    <div className="rounded-2xl border border-border/50 overflow-hidden">
      <div className="px-4 py-2.5 bg-secondary/40 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Produtos consumidos (estoque)</div>
      <div className="divide-y divide-border/40">
        {data.consumedItems.map((m, i) => (
          <div key={i} className="flex items-center justify-between px-4 py-2.5 text-sm">
            <span>{m.productName}</span>
            <span className="text-muted-foreground text-xs">{m.quantity} {m.unit}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Appointment detail sheet ----------
function AppointmentDetailSheet({
  appointment, onClose, onEdit,
}: {
  appointment: Appointment | null;
  onClose: () => void;
  onEdit: (a: Appointment) => void;
}) {
  const qc = useQueryClient();
  const [completeOpen, setCompleteOpen] = useState(false);
  const [revertOpen, setRevertOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const open = !!appointment;
  const a = appointment;

  const invalidate = () => qc.invalidateQueries({ queryKey: ["appointments"] });

  const confirmMut = useMutation({
    mutationFn: () => confirmAppointment(a!.id),
    onSuccess: () => { toast.success("Agendamento confirmado"); invalidate(); },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Erro ao confirmar"),
  });
  const cancelMut = useMutation({
    mutationFn: () => cancelAppointment(a!.id),
    onSuccess: () => { toast.success("Agendamento cancelado"); invalidate(); setCancelOpen(false); onClose(); },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Erro ao cancelar"),
  });

  return (
    <>
      <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
        <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
          {a && (
            <>
              <SheetHeader className="px-6 pt-6 pb-2">
                <SheetTitle className="sr-only">{a.client?.full_name ?? "Agendamento"}</SheetTitle>
                <div className="flex items-center justify-between">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    {fmtHour(hourOf(a.starts_at))} — {fmtHour(hourOf(a.ends_at))}
                  </div>
                  <span className={cn("text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full", STATUS[a.status].badge)}>
                    {STATUS[a.status].label}
                  </span>
                </div>

                <div className="mt-3 flex items-center gap-3">
                  <Avatar name={a.client?.full_name ?? "Cliente"} />
                  <div className="min-w-0">
                    <div className="text-xl font-display font-medium truncate">{a.client?.full_name ?? "Cliente"}</div>
                    <div className="text-xs text-muted-foreground truncate">{a.service_name ?? a.service?.name ?? "Atendimento"}</div>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2">
                  {a.status === "pending" && <ActionBtn icon={Check} label="Confirmar" onClick={() => confirmMut.mutate()} disabled={confirmMut.isPending} />}
                  {(a.status === "pending" || a.status === "confirmed") && <ActionBtn icon={Pencil} label="Editar" onClick={() => onEdit(a)} />}
                  {(a.status === "pending" || a.status === "confirmed") && <ActionBtn icon={X} label="Cancelar" onClick={() => setCancelOpen(true)} />}
                  {a.status === "completed" && <ActionBtn icon={Pencil} label="Editar horário" onClick={() => onEdit(a)} />}
                </div>
              </SheetHeader>

              <div className="flex-1 overflow-auto px-6 py-4 space-y-4">
                <div className="space-y-2 text-sm">
                  <Row icon={Phone} label={a.client?.phone ?? "—"} />
                  <Row icon={DollarSign} label="Valor" right={formatBRL(Number(a.price))} />
                  <Row icon={Clock} label="Duração" right={`${Math.round((hourOf(a.ends_at) - hourOf(a.starts_at)) * 60)} min`} />
                  <Row icon={User} label="Profissional" right={a.professional?.full_name ?? "Você"} />
                </div>

                {a.notes && (
                  <div className="rounded-2xl border border-border/50 p-4">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Observações</div>
                    <div className="text-sm text-foreground/80">{a.notes}</div>
                  </div>
                )}

                {a.status === "completed" && <ConsumedProducts appointmentId={a.id} />}
              </div>

              <div className="p-4 border-t border-border/50 bg-background">
                {(a.status === "pending" || a.status === "confirmed") && (
                  <Button className="w-full h-12 rounded-2xl gap-2 text-sm" onClick={() => setCompleteOpen(true)}>
                    <CheckCircle2 className="w-4 h-4" /> Concluir atendimento
                  </Button>
                )}
                {a.status === "completed" && (
                  <Button variant="outline" className="w-full h-12 rounded-2xl gap-2 text-sm" onClick={() => setRevertOpen(true)}>
                    <RotateCcw className="w-4 h-4" /> Desmarcar conclusão
                  </Button>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {a && (
        <>
          <CompleteConfirmDialog appointment={a} open={completeOpen} onOpenChange={setCompleteOpen} onDone={() => { invalidate(); onClose(); }} />
          <RevertConfirmDialog appointment={a} open={revertOpen} onOpenChange={setRevertOpen} onDone={() => { invalidate(); onClose(); }} />
          <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Cancelar agendamento?</AlertDialogTitle>
                <AlertDialogDescription>
                  {a.client?.full_name ?? "Cliente"} · {a.service_name ?? "Atendimento"} às {fmtHour(hourOf(a.starts_at))}. Essa ação libera o horário na agenda.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Voltar</AlertDialogCancel>
                <AlertDialogAction onClick={() => cancelMut.mutate()} disabled={cancelMut.isPending}>
                  {cancelMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Cancelar agendamento"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </>
  );
}

// ---------- Block detail sheet ----------
function BlockDetailSheet({ block, onClose }: { block: AgendaBlock | null; onClose: () => void }) {
  const qc = useQueryClient();
  const open = !!block;
  const del = useMutation({
    mutationFn: () => deleteBlock(block!.id),
    onSuccess: () => { toast.success("Bloqueio removido"); qc.invalidateQueries({ queryKey: ["blocks"] }); onClose(); },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Erro ao remover"),
  });

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-sm">
        {block && (
          <div className="space-y-4">
            <SheetHeader>
              <SheetTitle>Horário bloqueado</SheetTitle>
            </SheetHeader>
            <div className="text-sm space-y-1">
              <Row icon={Clock} label={`${fmtHour(hourOf(block.starts_at))} — ${fmtHour(hourOf(block.ends_at))}`} />
              <Row icon={User} label={block.professional?.full_name ?? "Você"} />
              {block.reason && <Row icon={Ban} label={block.reason} />}
            </div>
            <Button variant="destructive" className="w-full rounded-xl" onClick={() => del.mutate()} disabled={del.isPending}>
              {del.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Remover bloqueio"}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ---------- Appointment create/edit form ----------
type FormState = {
  clientId: string;
  clientName: string;
  serviceId: string;
  professionalId: string; // "self" ou id de team_members
  date: string;
  startTime: string;
  endTime: string;
  price: string;
  notes: string;
};

function buildInitialForm(appointment: Appointment | undefined, prefillStart: Date | undefined): FormState {
  if (appointment) {
    const s = new Date(appointment.starts_at);
    const e = new Date(appointment.ends_at);
    return {
      clientId: appointment.client_id,
      clientName: appointment.client?.full_name ?? "",
      serviceId: appointment.service_id ?? "",
      professionalId: appointment.professional_id ?? "self",
      date: toLocalDateStr(s),
      startTime: toLocalTimeStr(s),
      endTime: toLocalTimeStr(e),
      price: String(appointment.price),
      notes: appointment.notes ?? "",
    };
  }
  const base = prefillStart ? new Date(prefillStart) : new Date();
  if (!prefillStart) { base.setMinutes(0, 0, 0); if (base.getHours() < 8 || base.getHours() > 19) base.setHours(9); }
  const end = new Date(base.getTime() + 60 * 60000);
  return {
    clientId: "", clientName: "", serviceId: "", professionalId: "self",
    date: toLocalDateStr(base), startTime: toLocalTimeStr(base), endTime: toLocalTimeStr(end),
    price: "0", notes: "",
  };
}

function AppointmentFormSheet({
  mode, appointment, prefillStart, clients, services, professionals, onClose,
}: {
  mode: "create" | "edit";
  appointment?: Appointment;
  prefillStart?: Date;
  clients: Client[];
  services: Service[];
  professionals: TeamMember[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const isCompletedEdit = mode === "edit" && appointment?.status === "completed";
  const [form, setForm] = useState<FormState>(() => buildInitialForm(appointment, prefillStart));
  const [conflicts, setConflicts] = useState<ConflictItem[] | null>(null);
  const [checking, setChecking] = useState(false);

  const selectedService = services.find((s) => s.id === form.serviceId);

  const handleServiceChange = (serviceId: string) => {
    const svc = services.find((s) => s.id === serviceId);
    setForm((f) => {
      if (!svc) return { ...f, serviceId };
      const start = combineLocal(f.date, f.startTime);
      const end = new Date(start.getTime() + svc.duration_min * 60000);
      return { ...f, serviceId, price: String(svc.price), endTime: toLocalTimeStr(end) };
    });
  };

  const handleStartTimeChange = (startTime: string) => {
    setForm((f) => {
      if (!selectedService) return { ...f, startTime };
      const start = combineLocal(f.date, startTime);
      const end = new Date(start.getTime() + selectedService.duration_min * 60000);
      return { ...f, startTime, endTime: toLocalTimeStr(end) };
    });
  };

  const saveMut = useMutation({
    mutationFn: async (forceOverlap: boolean) => {
      const startsAt = combineLocal(form.date, form.startTime).toISOString();
      const endsAt = combineLocal(form.date, form.endTime).toISOString();
      if (isCompletedEdit) {
        return updateAppointmentTime(appointment!.id, startsAt, endsAt, forceOverlap);
      }
      const professionalId = form.professionalId === "self" ? null : form.professionalId;
      if (mode === "create") {
        return createAppointment({
          client_id: form.clientId,
          service_id: form.serviceId || null,
          service_name: selectedService?.name ?? null,
          professional_id: professionalId,
          starts_at: startsAt,
          ends_at: endsAt,
          price: Number(form.price) || 0,
          notes: form.notes || null,
          forceOverlap,
        });
      }
      return updateAppointment(appointment!.id, {
        client_id: form.clientId,
        service_id: form.serviceId || null,
        service_name: selectedService?.name ?? appointment?.service_name ?? null,
        professional_id: professionalId,
        starts_at: startsAt,
        ends_at: endsAt,
        price: Number(form.price) || 0,
        notes: form.notes || null,
        forceOverlap,
      });
    },
    onSuccess: () => {
      toast.success(mode === "create" ? "Agendamento criado" : "Agendamento atualizado");
      qc.invalidateQueries({ queryKey: ["appointments"] });
      setConflicts(null);
      onClose();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Erro ao salvar"),
  });

  const handleSubmit = async () => {
    if (!isCompletedEdit && !form.clientId) { toast.error("Selecione a cliente"); return; }
    const startsAt = combineLocal(form.date, form.startTime);
    const endsAt = combineLocal(form.date, form.endTime);
    if (endsAt <= startsAt) { toast.error("O horário final precisa ser depois do início"); return; }

    setChecking(true);
    try {
      const professionalId = isCompletedEdit ? (appointment!.professional_id ?? null) : (form.professionalId === "self" ? null : form.professionalId);
      const found = await findConflicts({
        professionalId,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        excludeAppointmentId: appointment?.id,
      });
      if (found.length > 0) setConflicts(found);
      else saveMut.mutate(false);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao checar conflitos");
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      <Sheet open onOpenChange={(v) => !v && onClose()}>
        <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
          <SheetHeader className="px-6 pt-6 pb-2">
            <SheetTitle>{mode === "create" ? "Novo agendamento" : "Editar agendamento"}</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-auto px-6 py-4 space-y-4">
            {isCompletedEdit && (
              <div className="rounded-2xl border border-amber-500/30 bg-amber-50/60 dark:bg-amber-500/5 p-4 text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
                Este atendimento já está concluído — aqui só é possível ajustar data e horário. Para alterar cliente,
                serviço, profissional ou valor, feche esta tela e use "Desmarcar conclusão" no atendimento antes de editar.
              </div>
            )}

            <Field label="Cliente">
              {isCompletedEdit ? (
                <div className="h-11 rounded-xl bg-secondary px-3 flex items-center text-sm text-muted-foreground">{form.clientName}</div>
              ) : (
                <ClientPicker clients={clients} value={form.clientId} onChange={(id, name) => setForm((f) => ({ ...f, clientId: id, clientName: name }))} />
              )}
            </Field>

            <Field label="Serviço">
              {isCompletedEdit ? (
                <div className="h-11 rounded-xl bg-secondary px-3 flex items-center text-sm text-muted-foreground">{appointment?.service_name ?? "—"}</div>
              ) : (
                <Select value={form.serviceId} onValueChange={handleServiceChange}>
                  <SelectTrigger className="h-11 rounded-xl bg-secondary border-0"><SelectValue placeholder="Selecionar serviço" /></SelectTrigger>
                  <SelectContent>
                    {services.filter((s) => s.active).map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name} · {formatBRL(s.price)} · {s.duration_min}min</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>

            <Field label="Profissional">
              {isCompletedEdit ? (
                <div className="h-11 rounded-xl bg-secondary px-3 flex items-center text-sm text-muted-foreground">{appointment?.professional?.full_name ?? "Você"}</div>
              ) : (
                <Select value={form.professionalId} onValueChange={(v) => setForm((f) => ({ ...f, professionalId: v }))}>
                  <SelectTrigger className="h-11 rounded-xl bg-secondary border-0"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="self">Eu mesma</SelectItem>
                    {professionals.map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </Field>

            <div className="grid grid-cols-3 gap-3">
              <Field label="Data">
                <Input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} className="h-11 rounded-xl bg-secondary border-0" />
              </Field>
              <Field label="Início">
                <Input type="time" value={form.startTime} onChange={(e) => handleStartTimeChange(e.target.value)} className="h-11 rounded-xl bg-secondary border-0" />
              </Field>
              <Field label="Fim">
                <Input type="time" value={form.endTime} onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))} className="h-11 rounded-xl bg-secondary border-0" />
              </Field>
            </div>

            <Field label="Valor">
              {isCompletedEdit ? (
                <div className="h-11 rounded-xl bg-secondary px-3 flex items-center text-sm text-muted-foreground">{formatBRL(Number(appointment?.price ?? 0))}</div>
              ) : (
                <Input type="number" step="0.01" min="0" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} className="h-11 rounded-xl bg-secondary border-0" />
              )}
            </Field>

            <Field label="Observações">
              <Textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={3} disabled={isCompletedEdit} className="rounded-xl bg-secondary border-0 resize-none" />
            </Field>
          </div>
          <div className="p-4 border-t border-border/50 bg-background flex gap-2">
            <Button variant="ghost" className="flex-1 rounded-xl" onClick={onClose}>Cancelar</Button>
            <Button className="flex-1 rounded-xl" onClick={handleSubmit} disabled={checking || saveMut.isPending}>
              {checking || saveMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salvar"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <ConflictDialog
        conflicts={conflicts ?? []}
        open={!!conflicts}
        onOpenChange={(v) => !v && setConflicts(null)}
        onConfirm={() => saveMut.mutate(true)}
        pending={saveMut.isPending}
      />
    </>
  );
}

// ---------- Block create form ----------
function BlockFormSheet({
  prefillStart, professionals, onClose,
}: {
  prefillStart?: Date;
  professionals: TeamMember[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const base = useMemo(() => {
    const d = prefillStart ? new Date(prefillStart) : new Date();
    if (!prefillStart) { d.setMinutes(0, 0, 0); if (d.getHours() < 8 || d.getHours() > 19) d.setHours(12); }
    return d;
  }, [prefillStart]);
  const [professionalId, setProfessionalId] = useState("self");
  const [date, setDate] = useState(toLocalDateStr(base));
  const [startTime, setStartTime] = useState(toLocalTimeStr(base));
  const [endTime, setEndTime] = useState(toLocalTimeStr(new Date(base.getTime() + 30 * 60000)));
  const [reason, setReason] = useState("");
  const [conflicts, setConflicts] = useState<ConflictItem[] | null>(null);
  const [checking, setChecking] = useState(false);

  const saveMut = useMutation({
    mutationFn: (forceOverlap: boolean) => createBlock({
      professional_id: professionalId === "self" ? null : professionalId,
      starts_at: combineLocal(date, startTime).toISOString(),
      ends_at: combineLocal(date, endTime).toISOString(),
      reason: reason || null,
      forceOverlap,
    }),
    onSuccess: () => {
      toast.success("Horário bloqueado");
      qc.invalidateQueries({ queryKey: ["blocks"] });
      setConflicts(null);
      onClose();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Erro ao bloquear"),
  });

  const handleSubmit = async () => {
    const startsAt = combineLocal(date, startTime);
    const endsAt = combineLocal(date, endTime);
    if (endsAt <= startsAt) { toast.error("O horário final precisa ser depois do início"); return; }
    setChecking(true);
    try {
      const found = await findConflicts({
        professionalId: professionalId === "self" ? null : professionalId,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
      });
      if (found.length > 0) setConflicts(found);
      else saveMut.mutate(false);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao checar conflitos");
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      <Sheet open onOpenChange={(v) => !v && onClose()}>
        <SheetContent side="right" className="w-full sm:max-w-sm p-0 flex flex-col">
          <SheetHeader className="px-6 pt-6 pb-2"><SheetTitle>Bloquear horário</SheetTitle></SheetHeader>
          <div className="flex-1 overflow-auto px-6 py-4 space-y-4">
            <Field label="Profissional">
              <Select value={professionalId} onValueChange={setProfessionalId}>
                <SelectTrigger className="h-11 rounded-xl bg-secondary border-0"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="self">Eu mesma</SelectItem>
                  {professionals.map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Data"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11 rounded-xl bg-secondary border-0" /></Field>
              <Field label="Início"><Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="h-11 rounded-xl bg-secondary border-0" /></Field>
              <Field label="Fim"><Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="h-11 rounded-xl bg-secondary border-0" /></Field>
            </div>
            <Field label="Motivo (opcional)">
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Almoço, compromisso pessoal…" className="h-11 rounded-xl bg-secondary border-0" />
            </Field>
          </div>
          <div className="p-4 border-t border-border/50 bg-background flex gap-2">
            <Button variant="ghost" className="flex-1 rounded-xl" onClick={onClose}>Cancelar</Button>
            <Button className="flex-1 rounded-xl" onClick={handleSubmit} disabled={checking || saveMut.isPending}>
              {checking || saveMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Bloquear"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <ConflictDialog
        conflicts={conflicts ?? []}
        open={!!conflicts}
        onOpenChange={(v) => !v && setConflicts(null)}
        onConfirm={() => saveMut.mutate(true)}
        pending={saveMut.isPending}
      />
    </>
  );
}
