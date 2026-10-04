// 麵包屑 for Mac — a sparrow in the menu bar that follows you across every app.
import AppKit
import ServiceManagement

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private var status: NSStatusItem!
    private var tracker: Tracker!
    private var overlay: OverlayController!
    private var hotkey: Hotkey!
    private var doubleTap: DoubleTap!

    func applicationDidFinishLaunching(_ n: Notification) {
        Engine.shared.start()
        tracker = Tracker(store: .shared)
        overlay = OverlayController()
        hotkey = Hotkey(keyCode: Hotkey.controlOptionZ.0, modifiers: Hotkey.controlOptionZ.1) { [weak self] in self?.overlay.toggle() }
        doubleTap = DoubleTap(key: TapKey.saved) { [weak self] in self?.overlay.toggle() }

        status = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        let img = NSImage(systemSymbolName: "bird", accessibilityDescription: "麵包屑")
        img?.isTemplate = true
        status.button?.image = img
        let menu = NSMenu()
        menu.delegate = self
        status.menu = menu

        if !AX.trusted { AX.askForPermission() }
        tracker.start()
        Log.write("launched \(Bundle.main.bundlePath) ax=\(AX.trusted)")
        // Global key monitors only start working once Accessibility is granted: re-install when it flips.
        if !AX.trusted {
            Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] t in
                guard AX.trusted else { return }
                t.invalidate()
                self?.doubleTap = DoubleTap(key: TapKey.saved) { [weak self] in self?.overlay.toggle() }
            }
        }
    }

    func applicationWillTerminate(_ n: Notification) {
        Store.shared.pause()
        Store.shared.saveNow()
    }

    // Rebuild the menu every time it opens so it's always current.
    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        let s = Store.shared
        if let p = s.previous() {
            menu.addItem(disabled("剛剛你在：\(p.verb) · \(p.subject)"))
        } else {
            menu.addItem(disabled("麵包屑正在跟著你 🐦"))
        }
        let places = s.recentPlaces(6)
        if !places.isEmpty {
            menu.addItem(.separator())
            for c in places {
                let item = NSMenuItem(title: "\(c.verb) · \(c.subject)", action: #selector(jumpTo(_:)), keyEquivalent: "")
                item.target = self
                item.representedObject = c
                item.toolTip = c.note.isEmpty ? c.app : "\(c.app) — \(c.note)"
                if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: c.bundleId) {
                    let icon = NSWorkspace.shared.icon(forFile: url.path)
                    icon.size = NSSize(width: 16, height: 16)
                    item.image = icon
                }
                menu.addItem(item)
            }
        }
        menu.addItem(.separator())
        let open = NSMenuItem(title: "叫出麵包屑（\(TapKey.saved == .off ? "⌃⌥Z" : TapKey.saved.short + " 或 ⌃⌥Z")）", action: #selector(showOverlay), keyEquivalent: "")
        open.target = self
        menu.addItem(open)
        let home = NSMenuItem(title: "打開主頁（接下來・足跡・罐子）", action: #selector(showMain), keyEquivalent: "o")
        home.target = self
        menu.addItem(home)
        let week = NSMenuItem(title: "📊 一週回顧", action: #selector(showWeek), keyEquivalent: "")
        week.target = self
        menu.addItem(week)
        let keys = NSMenuItem(title: "叫出方式", action: nil, keyEquivalent: "")
        let sub = NSMenu()
        for k in TapKey.allCases {
            let i = NSMenuItem(title: k.title, action: #selector(chooseKey(_:)), keyEquivalent: "")
            i.target = self
            i.representedObject = k.rawValue
            i.state = k == TapKey.saved ? .on : .off
            sub.addItem(i)
        }
        keys.submenu = sub
        menu.addItem(keys)
        let pause = NSMenuItem(title: tracker.paused ? "繼續記錄" : "暫停記錄", action: #selector(togglePause), keyEquivalent: "")
        pause.target = self
        menu.addItem(pause)
        if !AX.trusted {
            let ax = NSMenuItem(title: "⚠️ 授權「輔助使用」才看得到視窗標題…", action: #selector(askAX), keyEquivalent: "")
            ax.target = self
            menu.addItem(ax)
        }
        if !Browser.denied.isEmpty {
            let au = NSMenuItem(title: "⚠️ 讀不到瀏覽器分頁：到「自動化」允許麵包屑控制瀏覽器…", action: #selector(askAutomation), keyEquivalent: "")
            au.target = self
            menu.addItem(au)
        }
        let login = NSMenuItem(title: "開機時自動啟動", action: #selector(toggleLogin), keyEquivalent: "")
        login.target = self
        login.state = SMAppService.mainApp.status == .enabled ? .on : .off
        menu.addItem(login)
        let folder = NSMenuItem(title: "打開資料夾", action: #selector(openFolder), keyEquivalent: "")
        folder.target = self
        menu.addItem(folder)
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "結束 Crumbs 麵包屑", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
    }

    private func disabled(_ t: String) -> NSMenuItem {
        let i = NSMenuItem(title: t, action: nil, keyEquivalent: "")
        i.isEnabled = false
        return i
    }

    @objc private func jumpTo(_ sender: NSMenuItem) {
        if let c = sender.representedObject as? Crumb { Jumper.jump(to: c) }
    }
    @objc private func showOverlay() { overlay.show() }
    @objc private func showMain() { Engine.shared.showMain() }
    @objc private func showWeek() { Engine.shared.showDashboard() }
    @objc private func chooseKey(_ sender: NSMenuItem) {
        guard let raw = sender.representedObject as? String, let k = TapKey(rawValue: raw) else { return }
        TapKey.saved = k
        doubleTap.key = k
        Log.write("tap key → \(k.rawValue)")
    }
    @objc private func togglePause() { tracker.paused.toggle() }
    @objc private func askAX() {
        AX.askForPermission()
        NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!)
    }
    @objc private func askAutomation() {
        NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation")!)
    }
    @objc private func toggleLogin() {
        do {
            if SMAppService.mainApp.status == .enabled { try SMAppService.mainApp.unregister() } else { try SMAppService.mainApp.register() }
        } catch {
            let a = NSAlert()
            a.messageText = "沒辦法設定開機啟動"
            a.informativeText = "把「麵包屑」搬到「應用程式」資料夾後再試一次。\n\n(\(error.localizedDescription))"
            a.runModal()
        }
    }
    @objc private func openFolder() {
        try? FileManager.default.createDirectory(at: Store.shared.folder, withIntermediateDirectories: true)
        NSWorkspace.shared.open(Store.shared.folder)
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
