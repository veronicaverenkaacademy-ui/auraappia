import { createFileRoute, redirect } from "@tanstack/react-router";

// A conexão do WhatsApp (Evolution API, QR Code) foi unificada na aba
// "Conexão & IA" (/whatsapp/config), reaproveitando o mesmo
// WhatsAppConnectionCard — não existem mais duas telas de conexão. Mantida
// como redirecionamento para não quebrar links antigos que alguém possa ter
// salvo (ex: o item que existiu brevemente no grid de "Mais").
export const Route = createFileRoute("/_authenticated/whatsapp-lembretes")({
  beforeLoad: () => {
    throw redirect({ to: "/whatsapp/config" });
  },
});
