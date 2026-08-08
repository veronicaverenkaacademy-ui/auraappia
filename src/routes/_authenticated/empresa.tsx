import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, Check, X, Loader2, ExternalLink, Copy, Download } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PanelHeader, Field, Section } from "@/components/settings-ui";
import { useControlCenter, type ControlCenterState } from "@/lib/control-center";
import {
  getMyCompanyProfile,
  upsertCompanyProfile,
  checkCompanySlugAvailable,
} from "@/lib/companyProfile.functions";
import { slugify, type CompanyProfile } from "@/lib/companyProfile";

export const Route = createFileRoute("/_authenticated/empresa")({
  head: () => ({
    meta: [
      { title: "Empresa — AURA" },
      { name: "description", content: "Dados cadastrais e informações públicas do seu negócio." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: EmpresaPage,
});

type PublicForm = Omit<CompanyProfile, "owner_id">;

const EMPTY_PUBLIC_FORM: PublicForm = {
  slug: "",
  display_name: "",
  category: "",
  description: "",
  city: "",
  state: "",
  address: "",
  phone: "",
  whatsapp: "",
  instagram: "",
  facebook: "",
  tiktok: "",
  open_hours_text: "",
  logo_url: "",
  cover_image_url: "",
};

function EmpresaPage() {
  const { state, setState } = useControlCenter();
  const c = state.company;
  const update = (patch: Partial<ControlCenterState["company"]>) =>
    setState((s) => ({ ...s, company: { ...s.company, ...patch } }));

  const qc = useQueryClient();
  const getProfileFn = useServerFn(getMyCompanyProfile);
  const upsertFn = useServerFn(upsertCompanyProfile);
  const checkSlugFn = useServerFn(checkCompanySlugAvailable);

  const { data: profile, isLoading: loadingProfile } = useQuery({
    queryKey: ["my-company-profile"],
    queryFn: () => getProfileFn(),
  });

  const [form, setForm] = useState<PublicForm>(EMPTY_PUBLIC_FORM);
  const [hydratedFromProfile, setHydratedFromProfile] = useState(false);
  const [slugStatus, setSlugStatus] = useState<"idle" | "checking" | "available" | "unavailable">(
    "idle",
  );
  const [slugMessage, setSlugMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!loadingProfile && !hydratedFromProfile) {
      if (profile) setForm({ ...profile });
      setHydratedFromProfile(true);
    }
  }, [loadingProfile, profile, hydratedFromProfile]);

  useEffect(() => {
    if (!form.slug || form.slug === profile?.slug) {
      setSlugStatus("idle");
      return;
    }
    setSlugStatus("checking");
    const t = setTimeout(async () => {
      try {
        const res = await checkSlugFn({ data: { slug: form.slug } });
        setSlugStatus(res.available ? "available" : "unavailable");
        setSlugMessage(res.reason ?? null);
      } catch {
        setSlugStatus("idle");
      }
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.slug]);

  const patchForm = (p: Partial<PublicForm>) => setForm((f) => ({ ...f, ...p }));

  const save = useMutation({
    mutationFn: () => upsertFn({ data: form }),
    onSuccess: () => {
      toast.success("Portal público atualizado.");
      qc.invalidateQueries({ queryKey: ["my-company-profile"] });
      qc.invalidateQueries({ queryKey: ["company-slug"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível salvar."),
  });

  const importFromBrowser = () => {
    patchForm({
      display_name: form.display_name || c.fantasyName,
      city: form.city || c.city,
      state: form.state || c.state,
      address: form.address || c.address,
      phone: form.phone || c.phone,
      whatsapp: form.whatsapp || c.whatsapp,
      instagram: form.instagram || c.instagram,
      facebook: form.facebook || c.facebook,
      tiktok: form.tiktok || c.tiktok,
      open_hours_text: form.open_hours_text || c.openHours,
      slug: form.slug || slugify(c.fantasyName || ""),
    });
    toast.success("Dados deste navegador importados — revise e clique em Salvar.");
  };

  const publicUrl = form.slug ? `${window.location.origin}/l/${form.slug}` : "";
  const canSave =
    form.display_name.trim().length > 0 &&
    form.slug.trim().length >= 2 &&
    slugStatus !== "unavailable";

  return (
    <AppShell className="px-4 md:px-8 py-6 md:py-10 max-w-3xl mx-auto pb-28 md:pb-12">
      <Link to="/mais" className="inline-flex">
        <Button variant="ghost" size="icon" className="rounded-full mb-4">
          <ChevronLeft className="w-5 h-5" />
        </Button>
      </Link>

      <div className="space-y-6">
        <PanelHeader
          title="Empresa"
          desc="Dados cadastrais e informações públicas do seu negócio."
        />

        <Section title="Portal Público">
          <div className="space-y-4 py-2">
            <p className="text-xs text-muted-foreground -mt-1">
              Estes dados aparecem na sua Landing Pública, o link que você compartilha com clientes
              para agendar.
            </p>

            {!hasAnyBrowserData(c) ? null : (
              <button
                type="button"
                onClick={importFromBrowser}
                className="inline-flex items-center gap-2 text-xs text-primary hover:underline underline-offset-4"
              >
                <Download className="w-3.5 h-3.5" /> Importar dados salvos deste navegador
              </button>
            )}

            <div className="grid md:grid-cols-2 gap-4">
              <Field label="Nome">
                <Input
                  value={form.display_name}
                  onChange={(e) => patchForm({ display_name: e.target.value })}
                  placeholder="Nome do seu negócio"
                />
              </Field>
              <Field label="Categoria" hint="Ex.: Estúdio de cílios, Salão de beleza, Barbearia">
                <Input
                  value={form.category ?? ""}
                  onChange={(e) => patchForm({ category: e.target.value })}
                />
              </Field>
            </div>

            <Field
              label="Endereço público (slug)"
              hint={`${publicUrl || "aura.app/l/seu-endereco"}`}
            >
              <div className="relative">
                <Input
                  value={form.slug}
                  onChange={(e) => patchForm({ slug: slugify(e.target.value) })}
                  placeholder="minha-empresa"
                  className="pr-8"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2">
                  {slugStatus === "checking" && (
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  )}
                  {slugStatus === "available" && <Check className="w-4 h-4 text-emerald-600" />}
                  {slugStatus === "unavailable" && <X className="w-4 h-4 text-destructive" />}
                </span>
              </div>
              {slugStatus === "unavailable" && slugMessage && (
                <p className="text-[11px] text-destructive mt-1">{slugMessage}</p>
              )}
            </Field>

            <Field label="Descrição — Quem somos">
              <Textarea
                value={form.description ?? ""}
                onChange={(e) => patchForm({ description: e.target.value })}
                rows={3}
                maxLength={600}
              />
            </Field>

            <div className="grid md:grid-cols-3 gap-4">
              <Field label="Cidade">
                <Input
                  value={form.city ?? ""}
                  onChange={(e) => patchForm({ city: e.target.value })}
                  autoComplete="off"
                />
              </Field>
              <Field label="Estado">
                <Input
                  value={form.state ?? ""}
                  onChange={(e) => patchForm({ state: e.target.value })}
                  maxLength={2}
                  autoComplete="off"
                />
              </Field>
              <div className="md:col-span-3">
                <Field label="Endereço">
                  <Input
                    value={form.address ?? ""}
                    onChange={(e) => patchForm({ address: e.target.value })}
                    autoComplete="off"
                  />
                </Field>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <Field label="Telefone">
                <Input
                  value={form.phone ?? ""}
                  onChange={(e) => patchForm({ phone: e.target.value })}
                />
              </Field>
              <Field label="WhatsApp">
                <Input
                  value={form.whatsapp ?? ""}
                  onChange={(e) => patchForm({ whatsapp: e.target.value })}
                />
              </Field>
              <Field label="Instagram">
                <Input
                  value={form.instagram ?? ""}
                  onChange={(e) => patchForm({ instagram: e.target.value })}
                  placeholder="@"
                />
              </Field>
              <Field label="Facebook">
                <Input
                  value={form.facebook ?? ""}
                  onChange={(e) => patchForm({ facebook: e.target.value })}
                />
              </Field>
              <Field label="TikTok">
                <Input
                  value={form.tiktok ?? ""}
                  onChange={(e) => patchForm({ tiktok: e.target.value })}
                  placeholder="@"
                />
              </Field>
              <Field label="Horário de funcionamento">
                <Input
                  value={form.open_hours_text ?? ""}
                  onChange={(e) => patchForm({ open_hours_text: e.target.value })}
                  placeholder="Seg a Sex, 9h às 19h"
                />
              </Field>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <Field label="URL do logo" hint="Cole o link de uma imagem já hospedada">
                <Input
                  value={form.logo_url ?? ""}
                  onChange={(e) => patchForm({ logo_url: e.target.value })}
                  placeholder="https://…"
                />
              </Field>
              <Field label="URL da imagem de capa" hint="Cole o link de uma imagem já hospedada">
                <Input
                  value={form.cover_image_url ?? ""}
                  onChange={(e) => patchForm({ cover_image_url: e.target.value })}
                  placeholder="https://…"
                />
              </Field>
            </div>

            <div className="flex items-center justify-between gap-3 pt-2">
              <div className="flex items-center gap-2 min-w-0">
                {publicUrl && (
                  <>
                    <code className="text-xs px-3 py-1.5 rounded-full bg-muted/60 truncate">
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
                  </>
                )}
              </div>
              <Button
                onClick={() => save.mutate()}
                disabled={!canSave || save.isPending}
                className="rounded-full shrink-0"
              >
                {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salvar"}
              </Button>
            </div>
          </div>
        </Section>

        <Section title="Identidade fiscal">
          <div className="grid md:grid-cols-2 gap-4 py-2">
            <Field label="Razão social">
              <Input value={c.legalName} onChange={(e) => update({ legalName: e.target.value })} />
            </Field>
            <Field label="CNPJ">
              <Input
                value={c.cnpj}
                onChange={(e) => update({ cnpj: e.target.value })}
                placeholder="00.000.000/0000-00"
              />
            </Field>
            <Field label="Inscrição Municipal">
              <Input value={c.im} onChange={(e) => update({ im: e.target.value })} />
            </Field>
            <Field label="Inscrição Estadual">
              <Input value={c.ie} onChange={(e) => update({ ie: e.target.value })} />
            </Field>
            <Field label="E-mail">
              <Input
                value={c.email}
                onChange={(e) => update({ email: e.target.value })}
                type="email"
              />
            </Field>
            <Field label="Site">
              <Input value={c.site} onChange={(e) => update({ site: e.target.value })} />
            </Field>
          </div>
        </Section>

        <Section title="Endereço fiscal & formatos">
          <div className="grid md:grid-cols-3 gap-4 py-2">
            <Field label="CEP">
              <Input
                value={c.cep}
                onChange={(e) => update({ cep: e.target.value })}
                autoComplete="off"
              />
            </Field>
            <Field label="País">
              <Input value={c.country} onChange={(e) => update({ country: e.target.value })} />
            </Field>
            <Field label="Fuso horário">
              <Select value={c.timezone} onValueChange={(v) => update({ timezone: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="America/Sao_Paulo">America/Sao_Paulo</SelectItem>
                  <SelectItem value="America/Fortaleza">America/Fortaleza</SelectItem>
                  <SelectItem value="America/Manaus">America/Manaus</SelectItem>
                  <SelectItem value="Europe/Lisbon">Europe/Lisbon</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Idioma">
              <Select value={c.language} onValueChange={(v) => update({ language: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pt-BR">Português (BR)</SelectItem>
                  <SelectItem value="en-US">English (US)</SelectItem>
                  <SelectItem value="es-ES">Español</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Moeda">
              <Select value={c.currency} onValueChange={(v) => update({ currency: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BRL">Real (R$)</SelectItem>
                  <SelectItem value="USD">Dólar (US$)</SelectItem>
                  <SelectItem value="EUR">Euro (€)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Formato de data">
              <Select value={c.dateFormat} onValueChange={(v) => update({ dateFormat: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DD/MM/YYYY">DD/MM/AAAA</SelectItem>
                  <SelectItem value="MM/DD/YYYY">MM/DD/AAAA</SelectItem>
                  <SelectItem value="YYYY-MM-DD">AAAA-MM-DD</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Formato de hora">
              <Select value={c.timeFormat} onValueChange={(v) => update({ timeFormat: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="24h">24 horas</SelectItem>
                  <SelectItem value="12h">12 horas (AM/PM)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
        </Section>
      </div>
    </AppShell>
  );
}

function hasAnyBrowserData(c: ControlCenterState["company"]): boolean {
  return Boolean(c.fantasyName || c.city || c.address || c.phone || c.whatsapp || c.instagram);
}
