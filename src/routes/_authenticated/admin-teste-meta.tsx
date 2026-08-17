// Tela TEMPORÁRIA, só para validar a integração Meta Cloud API com uma conta
// real — não faz parte do produto, não é linkada em nenhum menu/nav. Chama
// exclusivamente connectMetaWhatsAppManual (whatsapp-meta-admin.functions.ts),
// que por sua vez só usa MetaCloudApiProvider.getConnectedIdentity — nenhuma
// segunda implementação da integração Meta.
//
// O access token nunca é logado, nunca volta na resposta, e é limpo do
// estado ANTES de esperar a resposta do servidor — mesmo em caso de erro, o
// campo já está vazio na tela.
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircle2, XCircle, ShieldAlert } from "lucide-react";
import { connectMetaWhatsAppManual } from "@/lib/whatsapp/whatsapp-meta-admin.functions";

export const Route = createFileRoute("/_authenticated/admin-teste-meta")({
  head: () => ({
    meta: [{ title: "Teste de conexão Meta — AURA" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminTesteMeta,
});

type TestResult =
  { kind: "success"; phoneNumber: string | null } | { kind: "failure"; error: string };

function AdminTesteMeta() {
  const connectFn = useServerFn(connectMetaWhatsAppManual);
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  const handleRun = async () => {
    if (!phoneNumberId.trim() || !accessToken.trim()) return;
    setRunning(true);
    setResult(null);
    const tokenToSend = accessToken;
    setAccessToken(""); // limpo do estado antes de esperar a resposta, sucesso ou falha
    try {
      const res = await connectFn({
        data: { phoneNumberId: phoneNumberId.trim(), accessToken: tokenToSend },
      });
      setResult(
        res.ok
          ? { kind: "success", phoneNumber: res.phoneNumber }
          : { kind: "failure", error: res.error },
      );
    } catch (e) {
      setResult({ kind: "failure", error: e instanceof Error ? e.message : "Falha inesperada." });
    } finally {
      setRunning(false);
    }
  };

  return (
    <AppShell title="Teste de conexão Meta" className="pb-24 md:pb-12">
      <div className="max-w-lg mx-auto px-4 md:px-8 py-8 space-y-6">
        <div className="rounded-2xl border border-amber-300/60 bg-amber-50/60 dark:bg-amber-500/5 p-4 flex items-start gap-2">
          <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800 dark:text-amber-300">
            Tela temporária, só para validar a integração Meta Cloud API com uma conta real. Não faz
            parte do produto final — grava a conexão da sua própria conta, exatamente como o fluxo
            público faria.
          </p>
        </div>

        <section className="rounded-3xl border border-border/60 bg-card p-6 space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Phone Number ID</label>
            <Input
              value={phoneNumberId}
              onChange={(e) => setPhoneNumberId(e.target.value)}
              placeholder="ID numérico do número na Meta"
              className="mt-1"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Access Token</label>
            <Input
              type="password"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder="Token gerado no Meta Developers"
              className="mt-1"
              autoComplete="off"
            />
          </div>
          <Button
            onClick={handleRun}
            disabled={running || !phoneNumberId.trim() || !accessToken.trim()}
            className="rounded-full"
          >
            {running ? "Testando…" : "Executar teste de conexão"}
          </Button>
        </section>

        {result && (
          <section className="rounded-3xl border border-border/60 bg-card p-6 space-y-3">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Teste de conexão Meta
            </div>
            <ResultRow label="Autenticação" ok={result.kind === "success"} />
            <ResultRow label="Phone Number ID" ok={result.kind === "success"} />
            <ResultRow label="Identidade Meta" ok={result.kind === "success"} />
            <div className="text-sm">
              Provider: <span className="font-medium">meta_cloud_api</span>
            </div>
            {result.kind === "success" ? (
              <>
                <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-medium text-sm">
                  <CheckCircle2 className="w-4 h-4" /> Resultado: CONECTADO
                </div>
                {result.phoneNumber && (
                  <div className="text-xs text-muted-foreground">
                    Número confirmado: {result.phoneNumber}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400 font-medium text-sm">
                  <XCircle className="w-4 h-4" /> Resultado: NÃO CONECTADO
                </div>
                <div className="text-xs text-muted-foreground break-words">{result.error}</div>
              </>
            )}
          </section>
        )}
      </div>
    </AppShell>
  );
}

function ResultRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span>{label}</span>
      <span
        className={
          ok ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
        }
      >
        {ok ? "PASSOU" : "FALHOU"}
      </span>
    </div>
  );
}
