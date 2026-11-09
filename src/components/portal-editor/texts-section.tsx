import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Field } from "@/components/settings-ui";
import type { PortalDraftForm } from "@/lib/portal/portal-draft-form";

function CharCount({ value, max }: { value: string | null; max: number }) {
  return (
    <span className="text-[10px] text-muted-foreground/70">
      {(value ?? "").length}/{max}
    </span>
  );
}

export function TextsSection({
  form,
  patchForm,
}: {
  form: PortalDraftForm;
  patchForm: (p: Partial<PortalDraftForm>) => void;
}) {
  return (
    <div className="space-y-4">
      <Field
        label="Título da capa"
        hint="Substitui o nome da empresa no topo do portal — deixe vazio para usar o nome de sempre."
      >
        <Input
          value={form.cover_title ?? ""}
          onChange={(e) => patchForm({ cover_title: e.target.value || null })}
          maxLength={80}
        />
        <div className="flex justify-end">
          <CharCount value={form.cover_title} max={80} />
        </div>
      </Field>
      <Field label="Subtítulo da capa">
        <Input
          value={form.cover_subtitle ?? ""}
          onChange={(e) => patchForm({ cover_subtitle: e.target.value || null })}
          maxLength={160}
        />
        <div className="flex justify-end">
          <CharCount value={form.cover_subtitle} max={160} />
        </div>
      </Field>
      <Field label="Mensagem de boas-vindas">
        <Textarea
          value={form.welcome_message ?? ""}
          onChange={(e) => patchForm({ welcome_message: e.target.value || null })}
          maxLength={300}
          rows={2}
        />
        <div className="flex justify-end">
          <CharCount value={form.welcome_message} max={300} />
        </div>
      </Field>
      <Field
        label="Texto do aviso (banner)"
        hint="Ainda não aparece no layout atual do portal — preparado para a próxima fase."
      >
        <Input
          value={form.banner_text ?? ""}
          onChange={(e) => patchForm({ banner_text: e.target.value || null })}
          maxLength={100}
        />
        <div className="flex justify-end">
          <CharCount value={form.banner_text} max={100} />
        </div>
      </Field>
      <Field
        label="Título do aviso importante"
        hint="Ainda não aparece no layout atual do portal — preparado para a próxima fase."
      >
        <Input
          value={form.important_title ?? ""}
          onChange={(e) => patchForm({ important_title: e.target.value || null })}
          maxLength={60}
        />
      </Field>
      <Field label="Texto do aviso importante">
        <Textarea
          value={form.important_text ?? ""}
          onChange={(e) => patchForm({ important_text: e.target.value || null })}
          maxLength={600}
          rows={3}
        />
        <div className="flex justify-end">
          <CharCount value={form.important_text} max={600} />
        </div>
      </Field>
    </div>
  );
}

const SECTION_TOGGLES: {
  key: keyof PortalDraftForm;
  label: string;
  desc: string;
  liveOnPortal: boolean;
}[] = [
  {
    key: "show_services",
    label: "Serviços",
    desc: "Lista de serviços disponíveis para agendar.",
    liveOnPortal: true,
  },
  {
    key: "show_professionals",
    label: "Profissionais",
    desc: "Equipe disponível para atendimento.",
    liveOnPortal: true,
  },
  { key: "show_location", label: "Localização", desc: "Endereço e mapa.", liveOnPortal: true },
  {
    key: "show_footer",
    label: "Rodapé",
    desc: "Direitos autorais e links de termos/privacidade.",
    liveOnPortal: true,
  },
  {
    key: "show_shortcuts",
    label: "Atalhos",
    desc: "Preparado para a próxima fase — ainda sem efeito no portal.",
    liveOnPortal: false,
  },
  {
    key: "show_banner",
    label: "Aviso (banner)",
    desc: "Preparado para a próxima fase — ainda sem efeito no portal.",
    liveOnPortal: false,
  },
  {
    key: "show_important",
    label: "Aviso importante",
    desc: "Preparado para a próxima fase — ainda sem efeito no portal.",
    liveOnPortal: false,
  },
];

export function SectionsTogglesSection({
  form,
  patchForm,
}: {
  form: PortalDraftForm;
  patchForm: (p: Partial<PortalDraftForm>) => void;
}) {
  return (
    <div className="space-y-1">
      {SECTION_TOGGLES.map((s) => (
        <div
          key={s.key}
          className="flex items-center justify-between gap-4 py-3 border-b border-border/50 last:border-0"
        >
          <div className="min-w-0">
            <div className="text-sm font-medium">{s.label}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{s.desc}</div>
          </div>
          <Switch
            checked={Boolean(form[s.key])}
            onCheckedChange={(v) => patchForm({ [s.key]: v } as Partial<PortalDraftForm>)}
          />
        </div>
      ))}
    </div>
  );
}
