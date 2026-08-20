import UIKit
import WebKit
import Capacitor

/// Contêiner nativo: uma UITabBar fixa por cima de uma única
/// CAPBridgeViewController (WebView persistente) — Opção B, decidida em
/// conversa: nunca troca de WebView por aba. O toque numa aba manda a SPA
/// (TanStack Router, via window.__auraNativeNav em native-bridge.ts)
/// navegar pra raiz daquela aba; a aba destacada é sincronizada
/// observando webView.url via KVO, não por mensagem explícita da página —
/// assim funciona também quando a navegação acontece só dentro da própria
/// WebView (ex: um link clicado na página), sem passar pela tab bar.
///
/// Histórico simples por decisão: cada toque sempre navega pra raiz da
/// aba, nunca lembra a última tela aberta dentro dela.
///
/// NÃO TESTADO em simulador/dispositivo real — este ambiente não tem
/// Xcode. Precisa de validação visual (tab bar renderizando, teclado,
/// gesto de voltar, layout em segundo plano) assim que houver acesso a
/// um Mac.
final class MainViewController: UIViewController {

    private struct Tab {
        let path: String
        let title: String
        let symbolName: String
    }

    // Mesma ordem/rotas do MobileBottomNav web (src/components/mobile-bottom-nav.tsx)
    // — os dois lados não compartilham essa lista automaticamente, mantida em
    // sincronia manualmente caso as abas mudem.
    private let tabs: [Tab] = [
        Tab(path: "/dashboard", title: "Início", symbolName: "house"),
        Tab(path: "/agenda", title: "Agenda", symbolName: "calendar"),
        Tab(path: "/clientes", title: "Clientes", symbolName: "person.2"),
        Tab(path: "/aura-ia", title: "AURA IA", symbolName: "sparkles"),
        Tab(path: "/mais", title: "Mais", symbolName: "ellipsis.circle"),
    ]

    // Caminhos onde a tab bar fica escondida: login/cadastro, portal
    // público da cliente, páginas legais, raiz.
    private let hiddenPrefixes: [String] = [
        "/auth",
        "/cadastro",
        "/l/",
        "/politica-de-privacidade",
        "/termos-de-uso",
        "/termo-consentimento",
    ]

    private let bridgeViewController = CAPBridgeViewController()
    private let tabBar = UITabBar()
    private var urlObservation: NSKeyValueObservation?

    private var webViewBottomToTabBar: NSLayoutConstraint!
    private var webViewBottomToView: NSLayoutConstraint!

    override func viewDidLoad() {
        super.viewDidLoad()
        setUpBridgeViewController()
        setUpTabBar()
        observeWebViewURL()
    }

    private func setUpBridgeViewController() {
        addChild(bridgeViewController)
        let webContainer = bridgeViewController.view!
        webContainer.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webContainer)

        // Duas âncoras alternativas pro rodapé da WebView: parando em cima
        // da tab bar quando ela está visível, ou ocupando a tela inteira
        // quando ela está escondida (login, portal público, etc.) — só uma
        // fica ativa por vez, alternada em syncTabBar.
        webViewBottomToTabBar = webContainer.bottomAnchor.constraint(equalTo: tabBar.topAnchor)
        webViewBottomToView = webContainer.bottomAnchor.constraint(equalTo: view.bottomAnchor)

        NSLayoutConstraint.activate([
            webContainer.topAnchor.constraint(equalTo: view.topAnchor),
            webContainer.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webContainer.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        webViewBottomToView.isActive = true

        bridgeViewController.didMove(toParent: self)

        // Gesto de arrastar da borda pra voltar (funciona com pushState do
        // TanStack Router, que entra no histórico interno da WKWebView do
        // mesmo jeito que navegação de página cheia).
        bridgeViewController.bridge?.webView?.allowsBackForwardNavigationGestures = true
    }

    private func setUpTabBar() {
        tabBar.translatesAutoresizingMaskIntoConstraints = false
        tabBar.delegate = self
        tabBar.items = tabs.enumerated().map { index, tab in
            let item = UITabBarItem(title: tab.title, image: UIImage(systemName: tab.symbolName), tag: index)
            return item
        }
        tabBar.isHidden = true
        view.addSubview(tabBar)

        NSLayoutConstraint.activate([
            tabBar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            tabBar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            tabBar.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
    }

    // Fonte única de verdade sobre qual aba está ativa e se a barra deve
    // aparecer: observa webView.url via KVO em vez de depender da própria
    // página avisar explicitamente — reflete tanto toques na tab bar quanto
    // navegação disparada só dentro da WebView.
    private func observeWebViewURL() {
        guard let webView = bridgeViewController.bridge?.webView else { return }
        urlObservation = webView.observe(\.url, options: [.initial, .new]) { [weak self] _, change in
            guard let self, let url = change.newValue ?? nil else { return }
            DispatchQueue.main.async {
                self.syncTabBar(forPath: url.path)
            }
        }
    }

    private func syncTabBar(forPath path: String) {
        let shouldHide = path == "/" || hiddenPrefixes.contains { path.hasPrefix($0) }
        guard tabBar.isHidden != shouldHide else {
            updateSelection(forPath: path)
            return
        }

        tabBar.isHidden = shouldHide
        webViewBottomToTabBar.isActive = !shouldHide
        webViewBottomToView.isActive = shouldHide
        view.setNeedsLayout()
        view.layoutIfNeeded()

        if !shouldHide {
            updateSelection(forPath: path)
        }
    }

    // Mesma lógica de prefixo do MobileBottomNav web
    // (pathname === tab.to || pathname.startsWith(tab.to)) — garante que
    // uma sub-rota (ex: /agenda/123) mantém a aba pai destacada.
    private func updateSelection(forPath path: String) {
        guard let index = tabs.firstIndex(where: { path == $0.path || path.hasPrefix($0.path) }) else { return }
        tabBar.selectedItem = tabBar.items?[index]
    }
}

extension MainViewController: UITabBarDelegate {
    func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
        let index = item.tag
        guard tabs.indices.contains(index) else { return }
        let path = tabs[index].path
        // Sempre navega pra raiz da aba — histórico simples por decisão,
        // nunca lembra a última tela aberta dentro dela.
        let escapedPath = path.replacingOccurrences(of: "'", with: "\\'")
        let js = "window.__auraNativeNav && window.__auraNativeNav('\(escapedPath)')"
        bridgeViewController.bridge?.webView?.evaluateJavaScript(js, completionHandler: nil)
    }
}
