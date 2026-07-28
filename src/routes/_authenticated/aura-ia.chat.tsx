import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { chatWithAura } from "@/lib/aura.functions";
import { Sparkles, Send, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/aura-ia/chat")({
  component: AuraChat,
});

type Msg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "Como foi minha semana?",
  "Quem são minhas clientes VIP?",
  "Quanto faturei este mês?",
  "Quais produtos estão em falta?",
  "Crie uma campanha para clientes inativas",
  "Qual meu serviço mais lucrativo?",
];

function AuraChat() {
  const send = useServerFn(chatWithAura);
  const [messages, setMessages] = useState<Msg[]>([
    { role: "assistant", content: "Olá! Sou a Aura, sua gerente executiva. Pergunte qualquer coisa sobre agenda, clientes, financeiro, estoque ou marketing — sempre respondo com base nos dados reais do seu negócio." },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSend = async (text: string) => {
    const clean = text.trim();
    if (!clean || loading) return;
    const next: Msg[] = [...messages, { role: "user", content: clean }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const { reply } = await send({ data: { messages: next.map((m) => ({ role: m.role, content: m.content })) } });
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro ao consultar a Aura.";
      toast.error(msg);
      setMessages((m) => [...m, { role: "assistant", content: `⚠️ ${msg}` }]);
    } finally {
      setLoading(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8.5rem)] md:h-[calc(100vh-8rem)] max-w-3xl mx-auto w-full">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 md:px-8 py-6 space-y-4">
        {messages.map((m, i) => (
          <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            {m.role === "assistant" && (
              <div className="w-8 h-8 rounded-full bg-ai-card text-ai-card-foreground flex items-center justify-center mr-2 shrink-0">
                <Sparkles className="w-4 h-4" />
              </div>
            )}
            <div
              className={cn(
                "max-w-[85%] md:max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap",
                m.role === "user"
                  ? "bg-foreground text-background rounded-br-md"
                  : "bg-card border border-border text-foreground rounded-bl-md"
              )}
            >
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground pl-10">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Aura está pensando…
          </div>
        )}
        {messages.length <= 1 && (
          <div className="pt-4">
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground mb-2 px-1">Sugestões</div>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => handleSend(s)}
                  className="text-xs font-medium px-3 py-2 rounded-full border border-border bg-card hover:bg-secondary transition"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-border/50 bg-background/80 backdrop-blur px-4 md:px-8 py-3">
        <div className="flex items-end gap-2 rounded-2xl border border-border bg-card p-2 pl-4">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend(input);
              }
            }}
            rows={1}
            placeholder="Pergunte algo à Aura…"
            className="flex-1 resize-none bg-transparent outline-none text-sm py-2 max-h-32"
            disabled={loading}
          />
          <button
            onClick={() => handleSend(input)}
            disabled={loading || !input.trim()}
            className="h-9 w-9 rounded-full bg-foreground text-background flex items-center justify-center shrink-0 disabled:opacity-40 transition"
            aria-label="Enviar"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}