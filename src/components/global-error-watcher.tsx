import { useEffect, useState } from "react";
import { Bug, X } from "lucide-react";

type CapturedError = {
  id: number;
  at: string;
  source: "erro" | "promessa não tratada";
  message: string;
  stack?: string;
};

let nextId = 1;

/**
 * DIAGNÓSTICO TEMPORÁRIO — captura qualquer erro de JS não tratado (throw fora de
 * try/catch, promise rejeitada sem .catch) e mostra na própria tela, sem precisar de
 * DevTools. Sem isso, uma falha silenciosa (ex.: navigate() que lança, uma query sem
 * tratamento de erro visível) só aparece pra quem está com o console aberto — e quem
 * testa pelo iPad nunca vê nada. Remover quando não for mais necessário para depuração.
 */
export function GlobalErrorWatcher() {
  const [errors, setErrors] = useState<CapturedError[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      setErrors((prev) => [
        ...prev,
        {
          id: nextId++,
          at: new Date().toLocaleTimeString("pt-BR"),
          source: "erro",
          message: event.message || String(event.error),
          stack: event.error instanceof Error ? event.error.stack : undefined,
        },
      ]);
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      setErrors((prev) => [
        ...prev,
        {
          id: nextId++,
          at: new Date().toLocaleTimeString("pt-BR"),
          source: "promessa não tratada",
          message: reason instanceof Error ? reason.message : String(reason),
          stack: reason instanceof Error ? reason.stack : undefined,
        },
      ]);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  if (errors.length === 0) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 left-4 z-[999] flex items-center gap-1.5 rounded-full bg-red-600 px-3 py-2 text-xs font-medium text-white shadow-lg"
      >
        <Bug className="w-3.5 h-3.5" />
        {errors.length} erro{errors.length > 1 ? "s" : ""} capturado{errors.length > 1 ? "s" : ""}
      </button>

      {open && (
        <div className="fixed inset-0 z-[1000] bg-black/50 flex items-end md:items-center justify-center p-4">
          <div className="w-full max-w-lg max-h-[80vh] overflow-y-auto rounded-2xl bg-background border border-border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">Erros capturados nesta sessão</h2>
              <button onClick={() => setOpen(false)}><X className="w-4 h-4" /></button>
            </div>
            {errors.map((e) => (
              <div key={e.id} className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-xs font-mono break-all">
                <div className="text-muted-foreground">{e.at} · {e.source}</div>
                <div className="mt-1 text-foreground">{e.message}</div>
                {e.stack && <pre className="mt-1 whitespace-pre-wrap text-[10px] text-muted-foreground">{e.stack}</pre>}
              </div>
            ))}
            <p className="text-[11px] text-muted-foreground">
              Tire um print desta tela e mande — isso ajuda a achar a causa raiz sem precisar do console do navegador.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
