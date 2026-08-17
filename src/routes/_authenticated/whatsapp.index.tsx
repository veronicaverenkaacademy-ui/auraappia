import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listMessageHistory,
  getMessageHistoryStats,
  type HistoryEntry,
  type NotificationJobStatus,
  type NotificationJobType,
} from "@/lib/whatsapp/notification-history.functions";
import { getWhatsAppStatus } from "@/lib/whatsapp/whatsapp.functions";
import type { WhatsAppConnectionStatus } from "@/lib/whatsapp/provider";
import {
  Search,
  MessageSquare,
  Signal,
  ChevronRight,
  AlertTriangle,
  Clock3,
  CheckCircle2,
  CheckCheck,
  XCircle,
  Ban,
  Loader2,
  Eye,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const CONNECTION_LABEL: Record<WhatsAppConnectionStatus, string> = {
  pending: "WhatsApp não configurado ainda",
  connecting: "Conectando WhatsApp…",
  connected: "WhatsApp conectado",
  disconnected: "WhatsApp desconectado",
  error: "Erro na conexão do WhatsApp",
};

const CONNECTION_ICON: Record<WhatsAppConnectionStatus, typeof Signal> = {
  pending: AlertTriangle,
  connecting: Clock3,
  connected: CheckCircle2,
  disconnected: AlertTriangle,
  error: AlertTriangle,
};

const CONNECTION_TONE: Record<WhatsAppConnectionStatus, string> = {
  pending: "text-muted-foreground",
  connecting: "text-amber-600 dark:text-amber-400",
  connected: "text-emerald-500",
  disconnected: "text-muted-foreground",
  error: "text-rose-600 dark:text-rose-400",
};

const TYPE_LABEL: Record<NotificationJobType, string> = {
  appointment_confirmation: "Confirmação de agendamento",
  appointment_reminder_24h: "Lembrete 24h",
  appointment_reminder_2h: "Lembrete 2h",
};

const TYPE_FILTERS: { value: NotificationJobType | "all"; label: string }[] = [
  { value: "all", label: "Todas" },
  { value: "appointment_confirmation", label: "Confirmação" },
  { value: "appointment_reminder_24h", label: "Lembrete 24h" },
  { value: "appointment_reminder_2h", label: "Lembrete 2h" },
];

const STATUS_LABEL: Record<NotificationJobStatus, string> = {
  sent: "Enviada",
  pending: "Pendente",
  processing: "Processando",
  failed: "Falhou",
  cancelled: "Cancelada",
};

const STATUS_ICON: Record<NotificationJobStatus, typeof CheckCheck> = {
  sent: CheckCheck,
  pending: Clock3,
  processing: Loader2,
  failed: XCircle,
  cancelled: Ban,
};

const STATUS_TONE: Record<NotificationJobStatus, string> = {
  sent: "text-emerald-600 dark:text-emerald-400",
  pending: "text-amber-600 dark:text-amber-400",
  processing: "text-sky-600 dark:text-sky-400",
  failed: "text-rose-600 dark:text-rose-400",
  cancelled: "text-muted-foreground",
};

export const Route = createFileRoute("/_authenticated/whatsapp/")({
  component: WhatsAppHistory,
});

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (isToday) return `Hoje · ${time}`;
  return `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} · ${time}`;
}

function formatAppointmentDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} · ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}

function WhatsAppHistory() {
  const fetchStatus = useServerFn(getWhatsAppStatus);
  const { data: status } = useQuery({
    queryKey: ["whatsapp-status"],
    queryFn: () => fetchStatus(),
  });
  const connectionStatus = status?.status ?? "pending";
  const ConnectionIcon = CONNECTION_ICON[connectionStatus];

  const fetchStats = useServerFn(getMessageHistoryStats);
  const { data: stats } = useQuery({
    queryKey: ["whatsapp-history-stats"],
    queryFn: () => fetchStats(),
  });

  const [clientQuery, setClientQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<NotificationJobType | "all">("all");
  const [statusFilter, setStatusFilter] = useState<NotificationJobStatus | "all">("all");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<HistoryEntry | null>(null);

  const fetchHistory = useServerFn(listMessageHistory);
  const { data, isLoading } = useQuery({
    queryKey: ["whatsapp-history", clientQuery, typeFilter, statusFilter, page],
    queryFn: () =>
      fetchHistory({
        data: {
          clientQuery: clientQuery.trim() || undefined,
          type: typeFilter === "all" ? undefined : typeFilter,
          status: statusFilter === "all" ? undefined : statusFilter,
          page,
          pageSize: 20,
        },
      }),
  });

  const entries = useMemo(() => data?.entries ?? [], [data]);

  const resetToFirstPage = () => setPage(0);

  return (
    <div className="px-4 md:px-8 py-6 md:py-10 max-w-5xl mx-auto space-y-6">
      <header>
        <h1 className="text-3xl md:text-4xl font-display font-medium tracking-tight">
          Histórico de mensagens
        </h1>
        <p className="text-sm text-muted-foreground mt-1 flex items-center gap-2">
          <ConnectionIcon className={cn("w-3.5 h-3.5", CONNECTION_TONE[connectionStatus])} />
          {CONNECTION_LABEL[connectionStatus]}
          {status?.phoneNumber ? ` · ${status.phoneNumber}` : ""}
        </p>
        <p className="text-xs text-muted-foreground/80 mt-1">
          Acompanhe os envios automáticos realizados pelo AURA.
        </p>
      </header>

      <section className="grid grid-cols-3 gap-3">
        <MiniStat label="Enviadas" value={stats ? String(stats.sent) : "—"} tone="positive" />
        <MiniStat label="Pendentes" value={stats ? String(stats.pending) : "—"} tone="pending" />
        <MiniStat label="Falhas" value={stats ? String(stats.failed) : "—"} tone="failed" />
      </section>

      <section className="space-y-3">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={clientQuery}
            onChange={(e) => {
              setClientQuery(e.target.value);
              resetToFirstPage();
            }}
            placeholder="Buscar por cliente"
            className="pl-9 h-11 rounded-xl bg-secondary/40 border-border/50"
          />
        </div>

        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 md:mx-0 md:px-0">
          {TYPE_FILTERS.map((f) => (
            <Chip
              key={f.value}
              active={typeFilter === f.value}
              onClick={() => {
                setTypeFilter(f.value);
                resetToFirstPage();
              }}
            >
              {f.label}
            </Chip>
          ))}
        </div>

        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as NotificationJobStatus | "all");
            resetToFirstPage();
          }}
          className="h-10 px-3 rounded-xl bg-secondary/40 border border-border/50 text-sm"
        >
          <option value="all">Todos os status</option>
          {(Object.keys(STATUS_LABEL) as NotificationJobStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </section>

      <section className="space-y-2">
        {isLoading && (
          <div className="rounded-2xl border border-dashed border-border/60 p-10 text-center text-sm text-muted-foreground">
            Carregando…
          </div>
        )}

        {!isLoading && entries.length === 0 && (
          <EmptyState
            connectionStatus={connectionStatus}
            filtered={!!(clientQuery || typeFilter !== "all" || statusFilter !== "all")}
          />
        )}

        {!isLoading &&
          entries.map((e) => (
            <HistoryRow key={e.id} entry={e} onViewMessage={() => setSelected(e)} />
          ))}

        {!isLoading && data?.hasMore && (
          <button
            onClick={() => setPage((p) => p + 1)}
            className="w-full h-10 rounded-xl border border-border/60 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Carregar mais
          </button>
        )}
      </section>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mensagem enviada</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-3">
              <div className="text-xs text-muted-foreground">
                {selected.clientName ?? "Cliente não identificada"} · {TYPE_LABEL[selected.type]}
              </div>
              <div className="rounded-2xl bg-secondary/40 border border-border/50 p-4 text-sm leading-relaxed whitespace-pre-wrap">
                {selected.message || "(sem conteúdo registrado)"}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmptyState({
  connectionStatus,
  filtered,
}: {
  connectionStatus: WhatsAppConnectionStatus;
  filtered: boolean;
}) {
  if (filtered) {
    return (
      <div className="rounded-2xl border border-dashed border-border/60 p-10 text-center text-sm text-muted-foreground">
        Nenhum envio encontrado com esses filtros.
      </div>
    );
  }
  if (connectionStatus === "connected") {
    return (
      <div className="rounded-2xl border border-dashed border-border/60 p-10 text-center space-y-2">
        <MessageSquare className="w-6 h-6 mx-auto text-muted-foreground" />
        <p className="text-sm font-medium">Nenhum envio automático ainda.</p>
        <p className="text-xs text-muted-foreground">
          Assim que o AURA enviar uma confirmação ou lembrete, ele aparecerá aqui.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-dashed border-border/60 p-10 text-center space-y-2">
      <AlertTriangle className="w-6 h-6 mx-auto text-muted-foreground" />
      <p className="text-sm font-medium">WhatsApp não conectado.</p>
      <p className="text-xs text-muted-foreground">
        Conecte seu WhatsApp para que o AURA possa enviar mensagens automáticas.
      </p>
      <Link to="/whatsapp/config" className="inline-block text-xs font-medium hover:underline mt-1">
        Ir para configuração
      </Link>
    </div>
  );
}

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "positive" | "pending" | "failed";
}) {
  const color =
    tone === "positive"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "pending"
        ? "text-amber-600 dark:text-amber-400"
        : "text-rose-600 dark:text-rose-400";
  return (
    <div className="rounded-2xl bg-card border border-border/60 p-4">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("mt-2 text-2xl font-medium tracking-tight", color)}>{value}</div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "shrink-0 h-9 px-4 rounded-full text-xs font-medium border transition",
        active
          ? "bg-foreground text-background border-foreground"
          : "bg-card border-border/60 text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function HistoryRow({ entry, onViewMessage }: { entry: HistoryEntry; onViewMessage: () => void }) {
  const StatusIcon = STATUS_ICON[entry.status];
  const content = (
    <div className="rounded-2xl border border-border/60 bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">
            {entry.clientName ?? "Cliente não identificada"}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">{TYPE_LABEL[entry.type]}</div>
        </div>
        <div className="text-[11px] text-muted-foreground shrink-0">
          {formatDateTime(entry.createdAt)}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
        {entry.appointmentStartsAt && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Agendamento
            </div>
            <div className="mt-0.5">
              {formatAppointmentDateTime(entry.appointmentStartsAt)}
              {entry.serviceName ? ` · ${entry.serviceName}` : ""}
            </div>
          </div>
        )}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Status</div>
          <div
            className={cn("mt-0.5 flex items-center gap-1 font-medium", STATUS_TONE[entry.status])}
          >
            <StatusIcon
              className={cn("w-3.5 h-3.5", entry.status === "processing" && "animate-spin")}
            />
            {STATUS_LABEL[entry.status]}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Automação
          </div>
          <div className="mt-0.5">{TYPE_LABEL[entry.type]}</div>
        </div>
      </div>

      {entry.status === "failed" && entry.lastError && (
        <div className="text-[11px] text-rose-600 dark:text-rose-400">{entry.lastError}</div>
      )}

      <div className="flex items-center justify-between gap-3 pt-1">
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onViewMessage();
          }}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-secondary text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <Eye className="w-3.5 h-3.5" /> Ver mensagem
        </button>
        {entry.clientId && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            Ver cliente <ChevronRight className="w-3 h-3" />
          </span>
        )}
      </div>
    </div>
  );

  if (entry.clientId) {
    return (
      <Link to="/clientes/$id" params={{ id: entry.clientId }} className="block">
        {content}
      </Link>
    );
  }
  return content;
}
