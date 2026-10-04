// The main page: the Chrome extension's side panel + weekly dashboard, running inside the Mac app.
// One web view (the "engine") stays alive the whole time and owns the task list / jar / projects;
// Swift feeds it what the tracker sees. The dashboard window mirrors the engine's state.
import AppKit
import WebKit

private final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ t: WKScriptMessageHandler) { target = t }
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        target?.userContentController(c, didReceive: m)
    }
}

final class Engine: NSObject, WKScriptMessageHandler, WKUIDelegate, WKNavigationDelegate, NSWindowDelegate {
    static let shared = Engine()

    private var main: WKWebView!
    private var dash: WKWebView?
    private var mainWindow: NSWindow?
    private var dashWindow: NSWindow?
    private var ready = false
    private var pending: [String] = []
    private var latestState = "{}" { didSet { parseLater() } }

    /// 「等一下要做」: hand-written to-dos (optionally a link you haven't opened yet), newest first.
    struct Later: Identifiable { let id: String; let title: String; let url: String? }
    private(set) var later: [Later] = []

    private func parseLater() {
        guard let data = latestState.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let tasks = obj["tasks"] as? [String: [String: Any]] else { later = []; return }
        later = tasks.values
            .filter { ($0["manual"] as? Bool) == true && ($0["done"] as? Bool) != true }
            .sorted { ($0["firstSeen"] as? Double ?? 0) > ($1["firstSeen"] as? Double ?? 0) }
            .compactMap { t in
                guard let key = t["key"] as? String, let title = t["title"] as? String else { return nil }
                let url = (t["url"] as? String).flatMap { $0.isEmpty ? nil : $0 }
                return Later(id: key, title: title, url: url)
            }
    }

    func addLater(_ text: String) {
        let s = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !s.isEmpty else { return }
        var msg: [String: Any] = ["type": "addTask", "title": s, "later": true]
        if let u = URL(string: s), let scheme = u.scheme, ["http", "https"].contains(scheme), let host = u.host {
            msg["url"] = s
            let path = u.path.count > 1 ? u.path : ""
            msg["title"] = "🔗 " + host.replacingOccurrences(of: "www.", with: "") + (path.count > 28 ? String(path.prefix(27)) + "…" : path)
        }
        call("__crumbs.reduce(\(Self.json(msg)))")
        later.insert(Later(id: "pending-\(UUID().uuidString)", title: msg["title"] as! String, url: msg["url"] as? String), at: 0)
    }

    func completeLater(_ id: String) {
        later.removeAll { $0.id == id }
        guard !id.hasPrefix("pending-") else { return }
        call("__crumbs.reduce(\(Self.json(["type": "task", "key": id, "patch": ["done": true]])))")
    }
    private var webDir: URL { Bundle.main.resourceURL!.appendingPathComponent("web") }
    private var stateFile: URL { Store.shared.folder.appendingPathComponent("panel-state.json") }

    func start() {
        let saved = try? String(contentsOf: stateFile, encoding: .utf8)
        latestState = saved ?? "{}"
        main = makeWebView("panel.html", size: NSSize(width: 440, height: 780))
        if saved == nil { replayHistory() }
    }

    // First run: hand the engine what the tracker has already seen.
    private func replayHistory() {
        for c in Store.shared.crumbs where !c.flick {
            visit(c, at: c.startedAt)
            pause(at: c.startedAt.addingTimeInterval(c.activeSec))
        }
        if let c = Store.shared.current, Store.shared.isRunning { visit(c, at: Date()) }
    }

    private func makeWebView(_ page: String, size: NSSize) -> WKWebView {
        let cfg = WKWebViewConfiguration()
        let uc = WKUserContentController()
        uc.add(WeakHandler(self), name: "crumbs")
        uc.addUserScript(WKUserScript(source: "window.__CRUMBS_INITIAL__ = \(latestState);",
                                      injectionTime: .atDocumentStart, forMainFrameOnly: true))
        cfg.userContentController = uc
        let wv = WKWebView(frame: NSRect(origin: .zero, size: size), configuration: cfg)
        wv.uiDelegate = self
        wv.navigationDelegate = self
        wv.loadFileURL(webDir.appendingPathComponent(page), allowingReadAccessTo: webDir)
        return wv
    }

    // ── Swift → engine ─────────────────────────────────────────────
    private func call(_ js: String) {
        if ready { main.evaluateJavaScript(js) } else { pending.append(js) }
    }

    private static func json(_ obj: Any) -> String {
        let data = (try? JSONSerialization.data(withJSONObject: obj, options: [.fragmentsAllowed])) ?? Data("null".utf8)
        return String(decoding: data, as: UTF8.self)
    }
    private static func ms(_ d: Date) -> Double { (d.timeIntervalSince1970 * 1000).rounded() }

    func visit(_ c: Crumb, at: Date) {
        let tab = Describe.browsers.contains(c.bundleId) ? "b:" + c.bundleId : "a:" + c.bundleId
        call("__crumbs.visit(\(Self.json(["url": c.link, "title": c.title, "tabId": tab, "at": Self.ms(at)])))")
    }
    func pause(at: Date) { call("__crumbs.pause(\(Self.json(["at": Self.ms(at)])))") }
    func sync(_ info: [String: Any]) { call("__crumbs.sync(\(Self.json(info)))") }
    func forget(_ url: String) { call("__crumbs.forget(\(Self.json(url)))") }

    // ── engine → Swift ─────────────────────────────────────────────
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        guard let body = m.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "save":
            if let s = body["state"] as? String {
                try? FileManager.default.createDirectory(at: Store.shared.folder, withIntermediateDirectories: true)
                try? s.write(to: stateFile, atomically: true, encoding: .utf8)
            }
        case "changed":
            if let s = body["state"] as? String {
                latestState = s
                dash?.evaluateJavaScript("__crumbs.setState(\(Self.json(s)))")
            }
        case "jump":
            if let url = body["url"] as? String {
                Jumper.jump(link: url, title: body["title"] as? String ?? "")
            }
        case "forget":
            Store.shared.remove(links: Set(body["urls"] as? [String] ?? []))
        case "reduce":
            if let msg = body["msg"] { call("__crumbs.reduce(\(Self.json(msg)))") }
        case "dashboard":
            showDashboard()
        default: break
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard webView === main, !ready else { return }
        ready = true
        pending.forEach { main.evaluateJavaScript($0) }
        pending = []
    }

    // ── windows ────────────────────────────────────────────────────
    func showMain() {
        if mainWindow == nil {
            let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 440, height: 780),
                             styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                             backing: .buffered, defer: false)
            w.title = "麵包屑"
            w.titlebarAppearsTransparent = true
            w.titleVisibility = .hidden
            w.isReleasedWhenClosed = false
            w.minSize = NSSize(width: 360, height: 480)
            w.contentView = main
            w.delegate = self
            w.center()
            w.setFrameAutosaveName("CrumbsMain")
            mainWindow = w
        }
        present(mainWindow!)
    }

    func showDashboard() {
        if dashWindow == nil {
            let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 920, height: 860),
                             styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                             backing: .buffered, defer: false)
            w.title = "一週回顧"
            w.titlebarAppearsTransparent = true
            w.titleVisibility = .hidden
            w.isReleasedWhenClosed = false
            w.delegate = self
            w.center()
            w.setFrameAutosaveName("CrumbsDashboard")
            dashWindow = w
        }
        dash = makeWebView("dashboard.html", size: dashWindow!.frame.size) // fresh copy of the latest state
        dashWindow!.contentView = dash
        present(dashWindow!)
    }

    private func present(_ w: NSWindow) {
        // Show in the Dock / ⌘Tab while a window is open; back to menu-bar-only when all are closed.
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        w.makeKeyAndOrderFront(nil)
    }

    func windowWillClose(_ n: Notification) {
        if (n.object as? NSWindow) === dashWindow { dash = nil }
        DispatchQueue.main.async {
            let anyOpen = [self.mainWindow, self.dashWindow].contains { $0?.isVisible == true }
            if !anyOpen { NSApp.setActivationPolicy(.accessory) }
        }
    }

    // ── alert / confirm / prompt from the page ─────────────────────
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = NSAlert(); a.messageText = message; a.runModal(); completionHandler()
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = NSAlert(); a.messageText = message
        a.addButton(withTitle: "好"); a.addButton(withTitle: "取消")
        completionHandler(a.runModal() == .alertFirstButtonReturn)
    }
    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let a = NSAlert(); a.messageText = prompt
        a.addButton(withTitle: "好"); a.addButton(withTitle: "取消")
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 260, height: 24))
        field.stringValue = defaultText ?? ""
        a.accessoryView = field
        a.window.initialFirstResponder = field
        completionHandler(a.runModal() == .alertFirstButtonReturn ? field.stringValue : nil)
    }
}
