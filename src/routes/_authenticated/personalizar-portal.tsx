import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Capacitor } from "@capacitor/core";
import { ChevronLeft, Loader2, ExternalLink, Copy, Lock, Undo2, Eye } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { PanelHeader } from "@/components/settings-ui";
import { getMyCompanyProfile } from "@/lib/companyProfile.functions";
import {
  getPortalConfig,
  salvarRascunhoPortal,
  publicarPortal,
  descartarRascunhoPortal,
  desfazerPublicacaoPortal,
} from "@/lib/portal/portalConfig.functions";
import { getPortalMediaInfo } from "@/lib/portal/portal-media.functions";
import { listServices } from "@/lib/catalog";
import { listTeamMembers } from "@/lib/team";
import { draftFormFromRow, EMPTY_FORM, type PortalDraftForm } from "@/lib/portal/portal-draft-form";
import {
  PortalDraftPatchSchema,
  friendlyPortalDraftError,
  tabForFirstDraftIssue,
} from "@/lib/portal/portal-config.schema";
import { ImagesSection } from "@/components/portal-editor/images-section";
import { ColorsSection } from "@/components/portal-editor/colors-section";
import { FontSection } from "@/components/portal-editor/font-section";
import { TextsSection, SectionsTogglesSection } from "@/components/portal-editor/texts-section";
import { PortalPreviewFrame } from "@/components/portal-editor/preview-frame";
import { getPortalMediaPublicUrl } from "@/lib/portal/portal-media-browser";

export const Route = createFileRoute("/_authenticated/personalizar-portal")({
  head: () => ({
    meta: [
      { title: "Personalizar meu portal — AURA" },
      { name: "description", content: "Fotos, cores, fonte e textos do seu Portal Público." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PersonalizarPortalPage,
});

function PersonalizarPortalPage() {
  const isMobile = useIsMobile();
  const showBottomNav = isMobile && !Capacitor.isNativePlatform();
  const qc = useQueryClient();

  const getProfileFn = useServerFn(getMyCompanyProfile);
  const getConfigFn = useServerFn(getPortalConfig);
  const getMediaInfoFn = useServerFn(getPortalMediaInfo);
  const salvarFn = useServerFn(salvarRascunhoPortal);
  const publicarFn = useServerFn(publicarPortal);
  const descartarFn = useServerFn(descartarRascunhoPortal);
  const desfazerFn = useServerFn(desfazerPublicacaoPortal);

  const { data: profile } = useQuery({
    queryKey: ["my-company-profile"],
    queryFn: () => getProfileFn(),
  });
  const { data: configResult, isLoading: loadingConfig } = useQuery({
    queryKey: ["portal-config"],
    queryFn: () => getConfigFn(),
  });
  const {
    data: mediaInfo,
    isLoading: mediaInfoLoading,
    error: mediaInfoError,
  } = useQuery({
    queryKey: ["portal-media-info"],
    queryFn: () => getMediaInfoFn(),
  });
  const { data: services = [] } = useQuery({ queryKey: ["services"], queryFn: listServices });
  const { data: professionals = [] } = useQuery({
    queryKey: ["team-members"],
    queryFn: listTeamMembers,
  });

  const [form, setForm] = useState<PortalDraftForm>(EMPTY_FORM);
  const [hydrated, setHydrated] = useState(false);
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("imagens");

  useEffect(() => {
    if (!loadingConfig && !hydrated && configResult?.config) {
      const next = draftFormFromRow(configResult.config);
      setForm(next);
      setSavedSnapshot(JSON.stringify(next));
      setHydrated(true);
    }
  }, [loadingConfig, configResult, hydrated]);

  const patchForm = (p: Partial<PortalDraftForm>) => setForm((f) => ({ ...f, ...p }));
  const isDirty = savedSnapshot !== null && JSON.stringify(form) !== savedSnapshot;

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  const refetchConfig = () => qc.invalidateQueries({ queryKey: ["portal-config"] });

  // Mesmo esquema Zod do servidor (portal-config.schema.ts) — valida ANTES
  // de chamar o servidor, pra já levar a dona até a aba com o problema
  // (não dá pra saber isso só com a mensagem que volta do servidor, que não
  // carrega o caminho técnico do campo — nem deveria). O servidor continua
  // validando de novo (defesa em profundidade); isto aqui é só pra UX.
  const validateDraftBeforeSave = () => {
    const result = PortalDraftPatchSchema.safeParse(form);
    if (result.success) return;
    const tab = tabForFirstDraftIssue(result.error);
    if (tab) setActiveTab(tab);
    throw friendlyPortalDraftError(result.error);
  };

  const save = useMutation({
    mutationFn: () => {
      if (!configResult?.config) throw new Error("Configuração não carregada ainda.");
      validateDraftBeforeSave();
      return salvarFn({ data: { patch: form, version: configResult.config.version } });
    },
    onSuccess: () => {
      toast.success("Rascunho salvo.");
      setSavedSnapshot(JSON.stringify(form));
      refetchConfig();
    },
    onError: (e: Error) => {
      toast.error(e.message);
      if (e.message.includes("atualizou essa configuração")) refetchConfig();
    },
  });

  const publish = useMutation({
    mutationFn: async () => {
      if (!configResult?.config) throw new Error("Configuração não carregada ainda.");
      // Publicar sempre a partir do que está salvo — evita publicar um
      // rascunho que a dona ainda não confirmou que quer salvar.
      if (isDirty) {
        validateDraftBeforeSave();
        await salvarFn({ data: { patch: form, version: configResult.config.version } });
      }
      return publicarFn({ data: { version: configResult.config.version + (isDirty ? 1 : 0) } });
    },
    onSuccess: () => {
      toast.success("Publicado! As alterações já estão no ar.");
      setSavedSnapshot(JSON.stringify(form));
      refetchConfig();
    },
    onError: (e: Error) => {
      toast.error(e.message);
      if (e.message.includes("atualizou essa configuração")) refetchConfig();
    },
  });

  const discard = useMutation({
    mutationFn: () => descartarFn(),
    onSuccess: () => {
      toast.success("Rascunho descartado — voltou ao que está publicado.");
      setHydrated(false);
      refetchConfig();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const undo = useMutation({
    mutationFn: () => desfazerFn(),
    onSuccess: (res) => {
      if (res.result === "nada_para_desfazer") {
        toast("Não há nenhuma publicação anterior para restaurar.");
      } else {
        toast.success("Última publicação desfeita.");
      }
      setHydrated(false);
      refetchConfig();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const back = () => {
    if (isDirty && !confirm("Você tem alterações não salvas. Quer mesmo saiir sem salvar?")) {
      return;
    }
    window.history.back();
  };

  if (!loadingConfig && configResult && !configResult.canEdit) {
    return (
      <AppShell className="px-4 py-10 max-w-lg mx-auto text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-secondary flex items-center justify-center mx-auto">
          <Lock className="w-5 h-5 text-muted-foreground" />
        </div>
        <div className="text-sm font-medium">Esta área é exclusiva da dona da conta</div>
        <p className="text-xs text-muted-foreground">
          Fale com a responsável pela conta se precisar alterar a personalização do portal.
        </p>
        <Link to="/mais">
          <Button variant="outline" size="sm" className="rounded-full">
            Voltar
          </Button>
        </Link>
      </AppShell>
    );
  }

  const publicUrl = profile?.slug ? `${window.location.origin}/l/${profile.slug}` : "";
  const hasPublished = Boolean(configResult?.config?.published_at);
  const statusLabel = !hasPublished
    ? "Nunca publicado"
    : isDirty
      ? "Alterações não publicadas"
      : "Tudo publicado";

  return (
    <AppShell className="px-4 md:px-8 py-6 md:py-10 max-w-3xl mx-auto pb-44 md:pb-24">
      <button onClick={back} className="inline-flex">
        <Button variant="ghost" size="icon" className="rounded-full mb-4">
          <ChevronLeft className="w-5 h-5" />
        </Button>
      </button>

      <div className="space-y-6">
        <PanelHeader
          title="Personalizar meu portal"
          desc="Fotos, cores, fonte e textos da sua Landing Pública."
        />

        {publicUrl && (
          <div className="flex items-center gap-2 min-w-0 rounded-2xl bg-card border border-border/50 p-3">
            <code className="text-xs px-3 py-1.5 rounded-full bg-muted/60 truncate flex-1">
              {publicUrl}
            </code>
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full h-8 w-8 shrink-0"
              onClick={() => {
                navigator.clipboard.writeText(publicUrl);
                toast.success("Link copiado.");
              }}
            >
              <Copy className="w-3.5 h-3.5" />
            </Button>
            <a href={publicUrl} target="_blank" rel="noreferrer">
              <Button variant="ghost" size="icon" className="rounded-full h-8 w-8 shrink-0">
                <ExternalLink className="w-3.5 h-3.5" />
              </Button>
            </a>
          </div>
        )}

        <div className="flex items-center justify-between">
          <span
            className={cn(
              "text-xs px-3 py-1 rounded-full",
              !hasPublished
                ? "bg-muted text-muted-foreground"
                : isDirty
                  ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                  : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
            )}
          >
            {statusLabel}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="rounded-full gap-1.5"
            onClick={() => setPreviewOpen(true)}
          >
            <Eye className="w-3.5 h-3.5" /> Pré-visualizar
          </Button>
        </div>

        {loadingConfig || !hydrated ? (
          <div className="text-sm text-muted-foreground py-10 text-center">Carregando…</div>
        ) : (
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="bg-transparent p-0 h-auto gap-1 mb-4 overflow-x-auto flex-nowrap justify-start w-full no-scrollbar">
              {[
                { v: "imagens", l: "Imagens" },
                { v: "cores", l: "Cores" },
                { v: "fonte", l: "Fonte" },
                { v: "textos", l: "Textos" },
                { v: "secoes", l: "Seções" },
              ].map((t) => (
                <TabsTrigger
                  key={t.v}
                  value={t.v}
                  className="rounded-full px-4 h-9 text-sm data-[state=active]:bg-foreground data-[state=active]:text-background shrink-0"
                >
                  {t.l}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="imagens" className="mt-0">
              <ImagesSection
                form={form}
                patchForm={patchForm}
                configRow={configResult?.config ?? null}
                mediaKey={mediaInfo?.mediaKey ?? null}
                mediaKeyLoading={mediaInfoLoading}
                mediaKeyErrorMessage={
                  mediaInfoError instanceof Error ? mediaInfoError.message : null
                }
                usage={mediaInfo?.usage ?? { fileCount: 0, totalBytes: 0 }}
                onUsageChanged={() => qc.invalidateQueries({ queryKey: ["portal-media-info"] })}
                companyDisplayName={profile?.display_name ?? ""}
              />
            </TabsContent>
            <TabsContent value="cores" className="mt-0">
              <ColorsSection form={form} patchForm={patchForm} />
            </TabsContent>
            <TabsContent value="fonte" className="mt-0">
              <FontSection form={form} patchForm={patchForm} />
            </TabsContent>
            <TabsContent value="textos" className="mt-0">
              <TextsSection form={form} patchForm={patchForm} />
            </TabsContent>
            <TabsContent value="secoes" className="mt-0">
              <SectionsTogglesSection form={form} patchForm={patchForm} />
            </TabsContent>
          </Tabs>
        )}
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-sm">
          <DialogTitle className="sr-only">Pré-visualização do portal</DialogTitle>
          <PortalPreviewFrame
            form={form}
            logoUrl={
              form.logo_path ? getPortalMediaPublicUrl(form.logo_path) : (profile?.logo_url ?? null)
            }
            coverUrl={
              form.cover_path
                ? getPortalMediaPublicUrl(form.cover_path)
                : (profile?.cover_image_url ?? null)
            }
            displayName={profile?.display_name ?? ""}
            category={profile?.category ?? null}
            description={profile?.description ?? null}
            city={profile?.city ?? null}
            state={profile?.state ?? null}
            services={services}
            professionals={professionals.filter((p) => p.status === "active")}
          />
        </DialogContent>
      </Dialog>

      <div
        className={cn(
          "fixed left-0 right-0 z-40 border-t border-border/70 bg-background/95 backdrop-blur px-4 pt-3 md:px-8",
          showBottomNav ? "bottom-16" : "bottom-0",
        )}
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full"
              disabled={!hasPublished || undo.isPending}
              onClick={() => undo.mutate()}
            >
              <Undo2 className="w-3.5 h-3.5 mr-1.5" /> Desfazer publicação
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="rounded-full"
              disabled={!isDirty || discard.isPending}
              onClick={() => {
                if (confirm("Descartar o rascunho e voltar ao que está publicado?"))
                  discard.mutate();
              }}
            >
              Descartar
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="rounded-full"
              disabled={!isDirty || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salvar rascunho"}
            </Button>
            <Button
              size="sm"
              className="rounded-full"
              disabled={publish.isPending}
              onClick={() => publish.mutate()}
            >
              {publish.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Publicar"}
            </Button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
