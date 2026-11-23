// FASE IA-1 (Parte 3) — Laboratório de comparação Anthropic x Google.
// Acesso restrito (checado no SERVIDOR, não aqui): admin + e-mail em
// AURA_LAB_ALLOWED_EMAILS. Não aparece em nenhum menu — só acessível por
// quem souber a URL e estiver na lista. Dados sempre FALSOS (fake-studio).
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import {
  runLaboratory,
  type LabColumnResult,
  type LabQuestionResult,
} from "@/lib/aura-ai/laboratory/laboratory.functions";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/aura-ia/laboratorio")({
  component: Laboratorio,
});

function resultToText(col: LabColumnResult): string {
  const lines: string[] = [`=== ${col.provider.toUpperCase()} (${col.model ?? "sem modelo"}) ===`];
  for (const r of [...col.results, ...(col.weeklyReport ? [col.weeklyReport] : [])]) {
    lines.push(`\n--- ${r.question} ---`);
    lines.push(r.error ? `[erro] ${r.error}` : r.answerText);
    lines.push(
      `latência=${r.latencyMs}ms tokens_in=${r.inputTokens} tokens_out=${r.outputTokens} custo=${r.costUSD ?? "?"}`,
    );
    if (r.unmatchedNumbers.length > 0)
      lines.push(`⚠️ números não encontrados nos dados: ${r.unmatchedNumbers.join(", ")}`);
    if (r.isTrap)
      lines.push(
        r.refusedTrapCorrectly
          ? "✅ recusou a armadilha corretamente"
          : "⚠️ pode ter caído na armadilha",
      );
  }
  if (col.totals) {
    lines.push(
      `\nTotais: custo=${col.totals.totalCostUSD ?? "?"} latência=${col.totals.totalLatencyMs}ms tokens_in=${col.totals.totalInputTokens} tokens_out=${col.totals.totalOutputTokens}`,
    );
  }
  return lines.join("\n");
}

function Laboratorio() {
  const run = useServerFn(runLaboratory);
  const mutation = useMutation({
    mutationFn: () => run(),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao rodar o laboratório"),
  });
  const [copied, setCopied] = useState(false);

  const data = mutation.data;
  const fullText = data?.enabled ? data.columns.map(resultToText).join("\n\n") : "";

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Não foi possível copiar.");
    }
  };

  const downloadAll = () => {
    const blob = new Blob([fullText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "laboratorio-aura-ia.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto max-w-5xl px-4 md:px-8 py-6 md:py-10 space-y-6">
      <div>
        <h1 className="text-xl font-display font-medium">Laboratório de comparação — AURA IA</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Dados inteiramente falsos (estúdio sintético). Nunca usa o banco real.
        </p>
      </div>

      <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
        {mutation.isPending ? "Rodando…" : "Rodar comparação"}
      </Button>

      {data && !data.enabled && (
        <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
          {data.disabledReason}
        </div>
      )}

      {data?.enabled && (
        <>
          <div className="flex gap-2">
            <Button variant="outline" onClick={copyAll}>
              {copied ? "Copiado!" : "Copiar resultado"}
            </Button>
            <Button variant="outline" onClick={downloadAll}>
              Baixar .txt
            </Button>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            {data.columns.map((col) => (
              <ColumnView key={col.provider} col={col} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ColumnView({ col }: { col: LabColumnResult }) {
  if (!col.configured) {
    return (
      <div className="rounded-2xl border border-border p-5">
        <h2 className="font-semibold capitalize">{col.provider}</h2>
        <p className="text-sm text-muted-foreground mt-2">Chave não configurada.</p>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-border p-5 space-y-4">
      <div>
        <h2 className="font-semibold capitalize">{col.provider}</h2>
        <p className="text-xs text-muted-foreground">{col.model}</p>
      </div>
      {[...col.results, ...(col.weeklyReport ? [col.weeklyReport] : [])].map((r) => (
        <QuestionResultView key={r.questionId} r={r} />
      ))}
      {col.totals && (
        <div className="text-xs text-muted-foreground border-t border-border pt-3">
          Totais:{" "}
          {col.totals.totalCostUSD !== null
            ? `US$ ${col.totals.totalCostUSD.toFixed(4)}`
            : "custo não estimável"}{" "}
          · {col.totals.totalLatencyMs}ms · {col.totals.totalInputTokens} tokens entrada ·{" "}
          {col.totals.totalOutputTokens} tokens saída
        </div>
      )}
    </div>
  );
}

function QuestionResultView({ r }: { r: LabQuestionResult }) {
  return (
    <div className="border-b border-border pb-3 last:border-0">
      <div className="text-xs font-semibold">{r.question}</div>
      {r.error ? (
        <p className="text-xs text-destructive mt-1">{r.error}</p>
      ) : (
        <>
          <p className="text-sm mt-1 whitespace-pre-wrap">{r.answerText}</p>
          <div className="text-[11px] text-muted-foreground mt-1">
            {r.latencyMs}ms · {r.inputTokens}/{r.outputTokens} tokens ·{" "}
            {r.costUSD !== null ? `US$ ${r.costUSD.toFixed(5)}` : "custo não estimável"}
          </div>
          {r.unmatchedNumbers.length > 0 && (
            <div className="text-[11px] text-destructive mt-1">
              ⚠️ possível número inventado: {r.unmatchedNumbers.join(", ")}
            </div>
          )}
          {r.isTrap && (
            <div
              className={`text-[11px] mt-1 ${r.refusedTrapCorrectly ? "text-success" : "text-destructive"}`}
            >
              {r.refusedTrapCorrectly ? "✅ recusou a armadilha" : "⚠️ pode ter caído na armadilha"}
            </div>
          )}
        </>
      )}
    </div>
  );
}
