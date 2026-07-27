import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Sparkles, Send, Mic } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/aura-ia")({
  head: () => ({
    meta: [
      { title: "AURA IA — AURA" },
      { name: "description", content: "Sua assistente inteligente para o negócio." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuraIA,
});

const suggestions = [
  "Mostrar clientes inativas",
  "Resumo do meu dia",
  "Estoque baixo",
  "Faturamento do mês",
];

function AuraIA() {
  const [messages, setMessages] = useState<{ role: "user" | "aura"; text: string }[]>([
    { role: "aura", text: "Olá! 👋\nComo posso te ajudar hoje?" },
  ]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = (text: string) => {
    if (!text.trim()) return;
    setMessages((m) => [...m, { role: "user", text }]);
    setInput("");
    setTimeout(() => {
      setMessages((m) => [
        ...m,
        {
          role: "aura",
          text: "Ainda estou aprendendo sobre o seu negócio. Em breve responderei com dados reais da agenda, clientes e estoque.",
        },
      ]);
    }, 800);
  };

  return (
    <AppShell title="AURA IA" className="flex flex-col bg-ai-card text-ai-card-foreground md:bg-background md:text-foreground pb-24 md:pb-0">
      <div className="flex-1 flex flex-col max-w-3xl mx-auto w-full">
        <div className="flex-1 overflow-auto px-4 py-6 md:py-10" ref={scrollRef}>
          <div className="flex items-center gap-3 mb-8">
            <div className="w-12 h-12 rounded-full bg-ai-card-foreground/10 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-ai-card-foreground md:text-primary" />
            </div>
            <div>
              <div className="text-sm font-medium tracking-widest uppercase">AURA IA</div>
              <div className="text-xs opacity-70">Online</div>
            </div>
          </div>

          <div className="space-y-4">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={cn(
                    "max-w-[85%] md:max-w-[70%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-line",
                    m.role === "user"
                      ? "bg-ai-card-foreground text-ai-card md:bg-foreground md:text-background"
                      : "bg-ai-card-foreground/10 md:bg-secondary md:text-foreground"
                  )}
                >
                  {m.text}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="px-3 py-1.5 rounded-full border border-ai-card-foreground/20 md:border-border text-xs md:text-sm hover:bg-ai-card-foreground/10 md:hover:bg-secondary transition"
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="p-4 md:px-8 md:pb-8 border-t border-ai-card-foreground/10 md:border-border bg-ai-card md:bg-background">
          <div className="flex items-center gap-2 max-w-3xl mx-auto">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send(input)}
              placeholder="Digite sua pergunta…"
              className="flex-1 h-12 px-4 rounded-full bg-ai-card-foreground/10 md:bg-secondary text-sm placeholder:text-ai-card-foreground/50 md:placeholder:text-muted-foreground outline-none"
            />
            <Button
              size="icon"
              className="h-12 w-12 rounded-full bg-ai-card-foreground text-ai-card md:bg-foreground md:text-background shrink-0"
              onClick={() => send(input)}
            >
              {input ? <Send className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function cn(...classes: (string | false | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}
