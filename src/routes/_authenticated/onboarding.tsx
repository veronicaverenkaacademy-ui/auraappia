import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Check, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getSelfTeamMember, updateTeamMember } from "@/lib/team";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({ meta: [{ title: "Primeiro acesso · AURA" }, { name: "robots", content: "noindex" }] }),
  component: Onboarding,
});

function Onboarding() {
  const nav = useNavigate();
  const { data: me } = useQuery({ queryKey: ["self-member"], queryFn: getSelfTeamMember });
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [accept, setAccept] = useState(false);
  const [bio, setBio] = useState("");
  const [instagram, setInstagram] = useState("");

  const changePassword = async () => {
    if (pw.length < 6) return toast.error("Senha muito curta.");
    if (pw !== pw2) return toast.error("As senhas não coincidem.");
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) return toast.error(error.message);
    toast.success("Senha atualizada.");
    setStep(2);
  };

  const finish = async () => {
    if (!me) return;
    await updateTeamMember(me.id, { bio, instagram, onboarding_completed: true });
    toast.success("Perfil concluído.");
    nav({ to: "/meu-espaco" });
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-3xl border border-border/60 bg-card p-8 space-y-6">
        <div className="flex gap-2">
          {[1, 2, 3].map((n) => (
            <div key={n} className={`h-1 flex-1 rounded-full ${n <= step ? "bg-primary" : "bg-muted"}`} />
          ))}
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <div><div className="text-2xl font-display">Defina sua senha</div><p className="text-sm text-muted-foreground mt-1">Por segurança, troque a senha inicial fornecida.</p></div>
            <div className="space-y-2"><Label>Nova senha</Label><Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></div>
            <div className="space-y-2"><Label>Confirmar senha</Label><Input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></div>
            <Button className="w-full rounded-full gap-2" onClick={changePassword}>Continuar <ArrowRight className="w-4 h-4" /></Button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div><div className="text-2xl font-display">Termos e Privacidade</div><p className="text-sm text-muted-foreground mt-1">Leia e aceite para prosseguir.</p></div>
            <div className="rounded-2xl border border-border/50 p-4 max-h-56 overflow-y-auto text-xs text-muted-foreground leading-relaxed">
              Ao utilizar o AURA, você concorda em manter sigilo sobre os dados de clientes, respeitar a LGPD e usar o sistema exclusivamente para atividades profissionais autorizadas pelo administrador do estúdio.
            </div>
            <label className="flex items-start gap-3 text-sm cursor-pointer">
              <Checkbox checked={accept} onCheckedChange={(v) => setAccept(!!v)} />
              <span>Li e aceito os Termos de Uso e a Política de Privacidade.</span>
            </label>
            <Button className="w-full rounded-full gap-2" disabled={!accept} onClick={() => setStep(3)}>
              Continuar <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div><div className="text-2xl font-display">Complete seu perfil</div><p className="text-sm text-muted-foreground mt-1">Estas informações aparecerão para suas clientes.</p></div>
            <div className="space-y-2"><Label>Biografia</Label><Textarea rows={3} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Especialista em cílios, apaixonada por realçar a beleza natural." /></div>
            <div className="space-y-2"><Label>Instagram (opcional)</Label><Input value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="@seuinsta" /></div>
            <Button className="w-full rounded-full gap-2" onClick={finish}>
              <Check className="w-4 h-4" /> Concluir e entrar
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}