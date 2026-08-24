// Ponte entre a tab bar nativa (iOS, MainViewController.swift) e o
// roteamento client-side do TanStack Router. Só faz algo quando o app
// roda dentro do Capacitor (Capacitor.isNativePlatform()) — no navegador
// normal, window.__auraNativeNav nunca é definida, e não há nada do lado
// nativo chamando ela mesmo assim.
//
// Sentido nativo → web: o toque numa aba chama
// window.__auraNativeNav('/agenda') via evaluateJavaScript, que só chama
// router.navigate — sem recarregar a página, sem perder sessão/estado.
//
// Sentido web → nativo: deliberadamente NÃO tem um envio explícito daqui
// pro lado nativo. O código Swift observa webView.url diretamente (KVO),
// que já reflete navegação client-side (pushState) sem precisar que a
// página avise nada — evita depender de um canal de mensagem separado
// pra manter a aba ativa sincronizada.
import { Capacitor } from "@capacitor/core";
import type { AnyRouter } from "@tanstack/react-router";

declare global {
  interface Window {
    __auraNativeNav?: (path: string) => void;
  }
}

export function registerNativeNavBridge(router: AnyRouter): void {
  if (!Capacitor.isNativePlatform()) return;
  window.__auraNativeNav = (path: string) => {
    void router.navigate({ to: path });
  };
}
