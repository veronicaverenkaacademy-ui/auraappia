import type { CSSProperties } from "react";
import { Calendar, MapPin, Users } from "lucide-react";
import { fontFamilyForKey } from "@/lib/portal/portal-fonts";
import type { PortalDraftForm } from "@/lib/portal/portal-draft-form";

type PreviewService = { id: string; name: string; price: number; duration_min: number };
type PreviewProfessional = { id: string; full_name: string; avatar_url: string | null };

/**
 * Moldura de celular, só leitura — nada aqui cria agendamento nem envia
 * código. Tema isolado via CSS custom properties DENTRO deste contêiner
 * (nunca em :root/document.body), então nunca vaza pro resto do app nem
 * para a visita de outra empresa (cada render começa do zero, com os
 * valores desta própria empresa).
 */
export function PortalPreviewFrame({
  form,
  logoUrl,
  coverUrl,
  displayName,
  category,
  description,
  city,
  state,
  services,
  professionals,
}: {
  form: PortalDraftForm;
  logoUrl: string | null;
  coverUrl: string | null;
  displayName: string;
  category: string | null;
  description: string | null;
  city: string | null;
  state: string | null;
  services: PreviewService[];
  professionals: PreviewProfessional[];
}) {
  const vars: CSSProperties & Record<string, string> = {
    "--portal-primary": form.color_primary ?? "#111111",
    "--portal-secondary": form.color_secondary ?? "#6b6b6b",
    "--portal-button": form.color_button ?? "#111111",
    "--portal-button-text": form.color_button_text ?? "#ffffff",
    "--portal-text": form.color_text ?? "#111111",
    "--portal-background": form.color_background ?? "#ffffff",
    fontFamily: fontFamilyForKey(form.font_key),
  };

  return (
    <div className="flex flex-col items-center">
      <div
        className="w-[300px] h-[620px] rounded-[2.5rem] border-[6px] border-neutral-900 bg-neutral-900 overflow-hidden shadow-xl relative"
        data-portal-preview="true"
      >
        <div className="absolute top-0 left-0 right-0 z-10 bg-amber-400 text-amber-950 text-[10px] font-medium text-center py-1 uppercase tracking-wider">
          Pré-visualização
        </div>
        <div
          className="h-full overflow-y-auto pt-6"
          style={{ ...vars, color: "var(--portal-text)", background: "var(--portal-background)" }}
        >
          {form.show_banner && form.banner_text && (
            <div
              className="text-center text-xs py-1.5 px-3"
              style={{ background: "var(--portal-secondary)", color: "var(--portal-button-text)" }}
            >
              {form.banner_text}
            </div>
          )}

          {coverUrl ? (
            <div className="h-20 w-full overflow-hidden">
              <img src={coverUrl} alt="" className="h-full w-full object-cover" />
            </div>
          ) : (
            <div
              className="h-10 w-full"
              style={{ background: "var(--portal-secondary)", opacity: 0.3 }}
            />
          )}

          <div className="px-4">
            <div className={coverUrl ? "-mt-6" : "-mt-3"}>
              <div className="w-14 h-14 rounded-full border-4 border-white bg-white overflow-hidden flex items-center justify-center text-sm font-medium shadow-sm">
                {logoUrl ? (
                  <img src={logoUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span>{displayName.slice(0, 2).toUpperCase()}</span>
                )}
              </div>
            </div>

            <div className="mt-2 space-y-1">
              <div className="text-base font-semibold leading-tight">
                {form.cover_title || displayName}
              </div>
              {(form.cover_subtitle || category) && (
                <div className="text-[11px] opacity-70">{form.cover_subtitle || category}</div>
              )}
              {description && (
                <p className="text-[11px] opacity-80 leading-relaxed">{description}</p>
              )}
              {city && (
                <div className="flex items-center gap-1 text-[10px] opacity-60">
                  <MapPin className="w-3 h-3" /> {city}
                  {state ? ` - ${state}` : ""}
                </div>
              )}
            </div>

            {form.welcome_message && (
              <p className="mt-2 text-[11px] italic opacity-80">{form.welcome_message}</p>
            )}

            <button
              type="button"
              disabled
              className="mt-3 w-full h-9 rounded-full text-xs font-medium flex items-center justify-center gap-1.5"
              style={{ background: "var(--portal-button)", color: "var(--portal-button-text)" }}
            >
              <Calendar className="w-3 h-3" /> Agendar Agora
            </button>

            {form.show_important && form.important_text && (
              <div
                className="mt-3 rounded-xl p-2.5 text-[10px]"
                style={{
                  background: "var(--portal-secondary)",
                  opacity: 0.85,
                  color: "var(--portal-button-text)",
                }}
              >
                {form.important_title && (
                  <div className="font-medium mb-0.5">{form.important_title}</div>
                )}
                {form.important_text}
              </div>
            )}

            {form.show_services && (
              <div className="mt-4">
                <div className="text-[11px] font-medium uppercase tracking-wide opacity-60 mb-1.5">
                  Serviços
                </div>
                {services.length === 0 ? (
                  <p className="text-[10px] opacity-50">Nenhum serviço cadastrado ainda.</p>
                ) : (
                  <div className="space-y-1">
                    {services.slice(0, 3).map((s) => (
                      <div key={s.id} className="flex justify-between text-[10px] opacity-80">
                        <span>{s.name}</span>
                        <span>R$ {s.price.toFixed(0)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {form.show_professionals && (
              <div className="mt-4">
                <div className="text-[11px] font-medium uppercase tracking-wide opacity-60 mb-1.5 flex items-center gap-1">
                  <Users className="w-3 h-3" /> Profissionais
                </div>
                {professionals.length === 0 ? (
                  <p className="text-[10px] opacity-50">A equipe estará disponível em instantes.</p>
                ) : (
                  <div className="flex gap-2">
                    {professionals.slice(0, 3).map((p) => (
                      <div key={p.id} className="text-center">
                        <div className="w-8 h-8 rounded-full bg-black/10 overflow-hidden mx-auto flex items-center justify-center text-[9px]">
                          {p.avatar_url ? (
                            <img src={p.avatar_url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            p.full_name.slice(0, 1)
                          )}
                        </div>
                        <div className="text-[9px] mt-0.5 opacity-70 truncate w-12">
                          {p.full_name}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {form.show_location && city && (
              <div className="mt-4 text-[10px] opacity-60">
                <div className="font-medium uppercase tracking-wide mb-1">Localização</div>
                {city}
                {state ? ` - ${state}` : ""}
              </div>
            )}

            {form.show_footer && (
              <div className="mt-6 mb-4 pt-3 border-t border-black/10 text-[9px] opacity-50 text-center">
                Powered by AURA
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
