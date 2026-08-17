import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listConversations,
  type ConversationSummary,
} from "@/lib/whatsapp/conversations.functions";
import { getWhatsAppStatus } from "@/lib/whatsapp/whatsapp.functions";
import type { WhatsAppConnectionStatus } from "@/lib/whatsapp/provider";
import {
  Search,
  MessageSquare,
  Sparkles,
  Signal,
  ChevronRight,
  AlertTriangle,
  Clock3,
  CheckCircle2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
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

export const Route = createFileRoute("/_authenticated/whatsapp/")({
  component: WhatsAppInbox,
});

function initialsFor(name: string | null, phone: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    const first = parts[0]?.[0] ?? "";
    const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
    return (first + last).toUpperCase();
  }
  const digits = phone.replace(/\D/g, "");
  return digits.slice(-2) || "?";
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  if (isToday) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function WhatsAppInbox() {
  const fetchStatus = useServerFn(getWhatsAppStatus);
  const { data: status } = useQuery({
    queryKey: ["whatsapp-status"],
    queryFn: () => fetchStatus(),
  });
  const connectionStatus = status?.status ?? "pending";
  const ConnectionIcon = CONNECTION_ICON[connectionStatus];

  const fetchConversations = useServerFn(listConversations);
  const { data: conversations, isLoading } = useQuery({
    queryKey: ["whatsapp-conversations"],
    queryFn: () => fetchConversations(),
  });

  const [q, setQ] = useState("");

  const list = useMemo(() => conversations ?? [], [conversations]);

  const filtered = useMemo(() => {
    if (!q.trim()) return list;
    const needle = q.toLowerCase();
    return list.filter((c) => {
      const name = (c.clientName ?? "").toLowerCase();
      const phone = c.phone.toLowerCase();
      return name.includes(needle) || phone.includes(needle);
    });
  }, [list, q]);

  return (
    <div className="px-4 md:px-8 py-6 md:py-10 max-w-5xl mx-auto space-y-6">
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-display font-medium tracking-tight">
            Central de conversas
          </h1>
          <p className="text-sm text-muted-foreground mt-1 flex items-center gap-2">
            <ConnectionIcon className={cn("w-3.5 h-3.5", CONNECTION_TONE[connectionStatus])} />
            {CONNECTION_LABEL[connectionStatus]}
            {status?.phoneNumber ? ` · ${status.phoneNumber}` : ""}
          </p>
        </div>
        <Link
          to="/whatsapp/config"
          className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-foreground text-background text-sm font-medium self-start md:self-auto"
        >
          <Sparkles className="w-4 h-4" /> Recepcionista IA
        </Link>
      </header>

      <section className="space-y-3">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por nome ou telefone"
            className="pl-9 h-11 rounded-xl bg-secondary/40 border-border/50"
          />
        </div>
        <div className="text-xs text-muted-foreground px-1">Todas · {list.length}</div>
      </section>

      <section className="space-y-2">
        {isLoading && (
          <div className="rounded-2xl border border-dashed border-border/60 p-10 text-center text-sm text-muted-foreground">
            Carregando conversas…
          </div>
        )}

        {!isLoading && list.length === 0 && <EmptyState connectionStatus={connectionStatus} />}

        {!isLoading &&
          list.length > 0 &&
          filtered.map((c) => <ConversationRow key={c.key} c={c} />)}

        {!isLoading && list.length > 0 && filtered.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border/60 p-10 text-center text-sm text-muted-foreground">
            Nenhuma conversa encontrada para "{q}".
          </div>
        )}
      </section>
    </div>
  );
}

function EmptyState({ connectionStatus }: { connectionStatus: WhatsAppConnectionStatus }) {
  if (connectionStatus === "connected") {
    return (
      <div className="rounded-2xl border border-dashed border-border/60 p-10 text-center space-y-2">
        <MessageSquare className="w-6 h-6 mx-auto text-muted-foreground" />
        <p className="text-sm font-medium">Seu WhatsApp está conectado.</p>
        <p className="text-xs text-muted-foreground">
          Quando uma cliente enviar uma mensagem, ela aparecerá aqui.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-dashed border-border/60 p-10 text-center space-y-2">
      <AlertTriangle className="w-6 h-6 mx-auto text-muted-foreground" />
      <p className="text-sm font-medium">WhatsApp não conectado.</p>
      <p className="text-xs text-muted-foreground">
        Conecte seu WhatsApp para começar a receber conversas aqui.
      </p>
      <Link to="/whatsapp/config" className="inline-block text-xs font-medium hover:underline mt-1">
        Ir para configuração
      </Link>
    </div>
  );
}

function ConversationRow({ c }: { c: ConversationSummary }) {
  return (
    <Link
      to="/whatsapp/$id"
      params={{ id: c.key }}
      className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card p-3 hover:border-border transition"
    >
      <div className="w-11 h-11 rounded-xl bg-secondary flex items-center justify-center text-sm font-semibold shrink-0">
        {initialsFor(c.clientName, c.phone)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">
          {c.clientName ?? "Contato não identificado"}
        </div>
        <div className="text-xs text-muted-foreground truncate mt-0.5">
          {c.lastMessageDirection === "out" ? "Você: " : ""}
          {c.lastMessagePreview || "(sem conteúdo)"}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <span className="text-[10px] text-muted-foreground">{formatTime(c.lastMessageAt)}</span>
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
    </Link>
  );
}
