// Watches which app / window / browser tab you're in. Everything stays on this Mac.
import AppKit
import ApplicationServices

enum AX {
    static var trusted: Bool { AXIsProcessTrusted() }

    static func askForPermission() {
        let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(opts)
    }

    static func focusedWindowTitle(pid: pid_t) -> String? {
        guard trusted else { return nil }
        let app = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(app, 0.25)
        var win: CFTypeRef?
        guard AXUIElementCopyAttributeValue(app, kAXFocusedWindowAttribute as CFString, &win) == .success, let w = win else { return nil }
        var title: CFTypeRef?
        guard AXUIElementCopyAttributeValue(w as! AXUIElement, kAXTitleAttribute as CFString, &title) == .success else { return nil }
        return title as? String
    }

    /// Titles of all of an app's windows (nil if we can't tell).
    static func windowTitles(pid: pid_t) -> [String]? {
        guard trusted else { return nil }
        let app = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(app, 0.25)
        var list: CFTypeRef?
        guard AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &list) == .success,
              let windows = list as? [AXUIElement] else { return nil }
        return windows.compactMap { w in
            var t: CFTypeRef?
            AXUIElementCopyAttributeValue(w, kAXTitleAttribute as CFString, &t)
            return t as? String
        }
    }

    /// Bring the window whose title matches to the front (best effort).
    static func raiseWindow(pid: pid_t, title: String) {
        guard trusted, !title.isEmpty else { return }
        let app = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(app, 0.5)
        var list: CFTypeRef?
        guard AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &list) == .success,
              let windows = list as? [AXUIElement] else { return }
        for w in windows {
            var t: CFTypeRef?
            AXUIElementCopyAttributeValue(w, kAXTitleAttribute as CFString, &t)
            if let s = t as? String, s == title || (!title.isEmpty && s.contains(title)) {
                AXUIElementPerformAction(w, kAXRaiseAction as CFString)
                AXUIElementSetAttributeValue(w, kAXMainAttribute as CFString, kCFBooleanTrue)
                return
            }
        }
    }
}

/// Talks to browsers through AppleScript (one serial queue; NSAppleScript isn't thread-safe).
enum Browser {
    private static let queue = DispatchQueue(label: "crumbs.applescript")
    private(set) static var denied = Set<String>()

    private static func run(_ source: String) -> String? {
        var err: NSDictionary?
        let out = NSAppleScript(source: source)?.executeAndReturnError(&err)
        return err == nil ? out?.stringValue : nil
    }

    /// (url, title) of the front tab, or nil if we're not allowed / no window.
    static func frontTab(_ bid: String, done: @escaping (String?, String?) -> Void) {
        if denied.contains(bid) { return done(nil, nil) }
        let src = bid == "com.apple.Safari"
            ? "tell application id \"\(bid)\" to if (count of windows) > 0 then return (URL of current tab of front window) & linefeed & (name of current tab of front window)"
            : "tell application id \"\(bid)\" to if (count of windows) > 0 then return (URL of active tab of front window) & linefeed & (title of active tab of front window)"
        queue.async {
            var err: NSDictionary?
            let out = NSAppleScript(source: src)?.executeAndReturnError(&err)
            let parts = out?.stringValue?.components(separatedBy: "\n")
            DispatchQueue.main.async {
                if let code = err?[NSAppleScript.errorNumber] as? Int {
                    if code == -1743 { denied.insert(bid) } // not allowed to control this browser
                    Log.write("applescript \(bid) error \(code)")
                }
                done(parts?.first, parts.flatMap { $0.count > 1 ? $0[1] : nil })
            }
        }
    }

    /// Every open tab's URL in a running browser (all windows, all Chrome profiles). nil = not allowed / failed.
    static func allURLs(_ bid: String, done: @escaping ([String]?) -> Void) {
        if denied.contains(bid) { return done(nil) }
        let src = """
            tell application id "\(bid)"
              set out to ""
              repeat with w in windows
                repeat with t in tabs of w
                  set out to out & (URL of t) & linefeed
                end repeat
              end repeat
              return out
            end tell
            """
        queue.async {
            let out = run(src)
            DispatchQueue.main.async { done(out.map { $0.split(separator: "\n").map(String.init) }) }
        }
    }

    /// Switch to the tab with this URL in any window (any Chrome profile). Opens it if it's gone.
    static func focus(_ bid: String, url: String) {
        let esc = url.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
        let src = bid == "com.apple.Safari" ? """
            tell application id "\(bid)"
              repeat with w in windows
                repeat with t in tabs of w
                  if URL of t is "\(esc)" then
                    set current tab of w to t
                    set index of w to 1
                    activate
                    return "ok"
                  end if
                end repeat
              end repeat
            end tell
            """ : """
            tell application id "\(bid)"
              repeat with w in windows
                set i to 0
                repeat with t in tabs of w
                  set i to i + 1
                  if URL of t is "\(esc)" then
                    set active tab index of w to i
                    set index of w to 1
                    activate
                    return "ok"
                  end if
                end repeat
              end repeat
            end tell
            """
        queue.async {
            let found = run(src) == "ok"
            if !found, let u = URL(string: url) {
                DispatchQueue.main.async { NSWorkspace.shared.open(u) }
            }
        }
    }
}

final class Tracker {
    private let store: Store
    private var timer: Timer?
    private var lastSig = ""
    private var idle = false
    static let idleAfter: TimeInterval = 5 * 60
    // System dialogs and overlays aren't "places".
    static let ignored: Set<String> = [
        "com.apple.loginwindow", "com.apple.ScreenSaver.Engine", "com.apple.accessibility.universalAccessAuthWarn",
        "com.apple.UserNotificationCenter", "com.apple.SecurityAgent", "com.apple.coreautha", "com.apple.dock",
        "com.apple.controlcenter", "com.apple.notificationcenterui", "com.apple.Spotlight", "com.apple.WindowManager",
    ]

    init(store: Store) { self.store = store }

    func start() {
        let nc = NSWorkspace.shared.notificationCenter
        nc.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { [weak self] _ in self?.tick() }
        for n in [NSWorkspace.willSleepNotification, NSWorkspace.screensDidSleepNotification, NSWorkspace.sessionDidResignActiveNotification] {
            nc.addObserver(forName: n, object: nil, queue: .main) { [weak self] _ in self?.store.pause(); self?.lastSig = "" }
        }
        for n in [NSWorkspace.didWakeNotification, NSWorkspace.screensDidWakeNotification, NSWorkspace.sessionDidBecomeActiveNotification] {
            nc.addObserver(forName: n, object: nil, queue: .main) { [weak self] _ in self?.tick() }
        }
        // Window titles change without an app switch (new doc, new tab): check every 1.5s.
        timer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { [weak self] _ in self?.tick() }
        // What's been closed? Check every 10s, and right away when an app quits.
        syncTimer = Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { [weak self] _ in self?.syncOpen() }
        nc.addObserver(forName: NSWorkspace.didTerminateApplicationNotification, object: nil, queue: .main) { [weak self] _ in self?.syncOpen() }
        tick()
    }

    private var syncTimer: Timer?

    /// Tell the store + main page what's still open, so closed tabs / windows / apps leave the lists.
    func syncOpen() {
        let apps = NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular }
        let running = Set(apps.compactMap(\.bundleIdentifier))
        // Window titles only for apps we have places in (cheap, and only with Accessibility).
        let tracked = Set(store.crumbs.map(\.bundleId)).subtracting(Describe.browsers)
        var windows: [String: [String]] = [:]
        for a in apps {
            guard let bid = a.bundleIdentifier, tracked.contains(bid),
                  let titles = AX.windowTitles(pid: a.processIdentifier) else { continue }
            let name = a.localizedName ?? bid
            windows[bid] = titles.map { Describe.clean($0, app: name) }
        }
        let browsers = running.intersection(Describe.browsers)
        var urls = Set<String>()
        var known = true
        let group = DispatchGroup()
        for b in browsers {
            group.enter()
            Browser.allURLs(b) { list in
                if let list { urls.formUnion(list) } else { known = false }
                group.leave()
            }
        }
        group.notify(queue: .main) { [weak self] in
            self?.store.removeClosed(running: running, windows: windows, openUrls: known ? urls : nil)
            var info: [String: Any] = ["runningApps": Array(running), "windows": windows, "webKnown": known]
            if known { info["openUrls"] = Array(urls) }
            Engine.shared.sync(info)
        }
    }

    var paused = false {
        didSet { if paused { store.pause(); lastSig = "" } else { tick() } }
    }

    func tick() {
        guard !paused else { return }
        // Away from the keyboard for a while → stop the clock.
        let anyInput = CGEventType(rawValue: ~0)!
        let away = CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: anyInput)
        if away > Self.idleAfter {
            if !idle { idle = true; store.pause(); lastSig = "" }
            return
        }
        idle = false
        guard let app = NSWorkspace.shared.frontmostApplication,
              let bid = app.bundleIdentifier, bid != Bundle.main.bundleIdentifier,
              !Self.ignored.contains(bid) else { return }
        let name = app.localizedName ?? bid
        let title = AX.focusedWindowTitle(pid: app.processIdentifier) ?? ""
        let sig = bid + "|" + title
        if sig == lastSig {
            if !store.isRunning { store.visit(bundleId: bid, app: name, title: store.current?.title ?? title, url: store.current?.url) }
            return
        }
        lastSig = sig
        if Describe.browsers.contains(bid) {
            Browser.frontTab(bid) { [weak self] url, tabTitle in
                let t = tabTitle ?? title
                // No URL and no title (e.g. an empty browser window) isn't a place.
                if url == nil && Describe.clean(t, app: name) == name { return }
                self?.store.visit(bundleId: bid, app: name, title: t, url: url)
            }
        } else {
            store.visit(bundleId: bid, app: name, title: title, url: nil)
        }
    }
}

enum Jumper {
    /// From the main page: an app:// link or a web URL.
    static func jump(link: String, title: String) {
        if let c = Store.shared.crumbs.last(where: { $0.link == link }) { return jump(to: c) }
        guard let u = URL(string: link) else { return }
        if u.scheme == "app", let bid = u.host {
            let subject = (u.path.removingPercentEncoding ?? "").trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            activate(bid, title: subject.isEmpty ? title : subject)
        } else {
            NSWorkspace.shared.open(u)
        }
    }

    static func jump(to c: Crumb) {
        if let url = c.url, Describe.browsers.contains(c.bundleId) {
            Browser.focus(c.bundleId, url: url)
            return
        }
        activate(c.bundleId, title: c.title)
    }

    static func activate(_ bid: String, title: String) {
        guard let appURL = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bid) else { return }
        // openApplication activates reliably even when we're a background app.
        let cfg = NSWorkspace.OpenConfiguration()
        cfg.activates = true
        NSWorkspace.shared.openApplication(at: appURL, configuration: cfg) { running, _ in
            guard let pid = running?.processIdentifier else { return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { AX.raiseWindow(pid: pid, title: title) }
        }
    }
}
