// The floating bar: double-tap ⌃ anywhere and it rises from the bottom of the screen (like Typeless's pill).
//   剛剛你在…  ·  這頁要做什麼  ·  等一下要做  ·  過去 24 小時（同一個網站合併）
import AppKit
import SwiftUI

final class OverlayPanel: NSPanel {
    var onKey: ((NSEvent) -> Bool)?
    var onPaste: (() -> Bool)?
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }

    // Arrow keys / Enter / Esc / Tab / Delete drive the list unless a text field is being edited.
    override func sendEvent(_ event: NSEvent) {
        if event.type == .keyDown, editShortcut(event) { return }
        if event.type == .keyDown, let onKey, onKey(event) { return }
        super.sendEvent(event)
    }

    /// A menu-bar app has no Edit menu, so ⌘X / ⌘C / ⌘V / ⌘A / ⌘Z need wiring by hand.
    private func editShortcut(_ e: NSEvent) -> Bool {
        let mods = e.modifierFlags.intersection(.deviceIndependentFlagsMask)
        guard mods == .command || mods == [.command, .shift], let key = e.charactersIgnoringModifiers?.lowercased() else { return false }
        let action: Selector? = switch (key, mods.contains(.shift)) {
        case ("x", false): #selector(NSText.cut(_:))
        case ("c", false): #selector(NSText.copy(_:))
        case ("v", false): #selector(NSText.paste(_:))
        case ("a", false): #selector(NSText.selectAll(_:))
        case ("z", false): Selector(("undo:"))
        case ("z", true): Selector(("redo:"))
        default: nil
        }
        guard let action else { return false }
        if action == #selector(NSText.paste(_:)), let onPaste, onPaste() { return true }
        return NSApp.sendAction(action, to: nil, from: self)
    }
}

enum OverlayFocus: Hashable { case list, note, later }

final class OverlayModel: ObservableObject {
    @Published var prev: Crumb?
    @Published var current: Crumb?
    @Published var groups: [Store.TrailGroup] = []
    @Published var later: [Engine.Later] = []
    @Published var selected = 0
    @Published var note = ""
    @Published var laterText = ""
    @Published var focus: OverlayFocus = .list
    @Published var hover: String?
    @Published var expanded = Set<String>()
    @Published var pasted: [String] = []      // several lines pasted into 等一下要做, waiting for Enter
    @Published var browserDenied = false

    func refresh() {
        let s = Store.shared
        current = s.current
        prev = s.previous()
        groups = s.trail(hours: 24)
        later = Engine.shared.later
        selected = 0
        note = current?.note ?? ""
        laterText = ""
        focus = .list
        expanded = []
        pasted = []
        browserDenied = !Browser.denied.isEmpty
    }

    /// Rough height of the scrolling history, so the panel can size itself.
    var trailHeight: CGFloat {
        guard !groups.isEmpty else { return 0 }
        var h: CGFloat = 0, lastHour = -1
        for g in groups {
            let hr = Calendar.current.component(.hour, from: g.head.startedAt)
            if hr != lastHour { h += 26; lastHour = hr }
            h += 34
            if expanded.contains(g.id) { h += CGFloat(max(0, g.pages.count - 1)) * 26 + 4 }
        }
        return min(h, 300)
    }
}

final class OverlayController: NSObject, NSWindowDelegate {
    private let panel: OverlayPanel
    private let model = OverlayModel()
    private var host: NSHostingView<OverlayView>!

    override init() {
        panel = OverlayPanel(contentRect: NSRect(x: 0, y: 0, width: 560, height: 420),
                             styleMask: [.nonactivatingPanel, .borderless, .fullSizeContentView],
                             backing: .buffered, defer: true)
        super.init()
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.hidesOnDeactivate = false
        panel.isMovableByWindowBackground = true
        panel.delegate = self
        host = NSHostingView(rootView: OverlayView(
            model: model,
            jump: { [weak self] c in self?.jump(c) },
            deleteGroup: { [weak self] g in self?.delete(g) },
            toggle: { [weak self] g in self?.toggle(g) },
            saveNote: { [weak self] in self?.saveNote() },
            addLater: { [weak self] in self?.addLater() },
            openLater: { [weak self] l in self?.openLater(l) },
            doneLater: { [weak self] l in self?.doneLater(l) },
            openMain: { [weak self] in self?.openMain() },
            fixBrowser: { [weak self] in self?.fixBrowser() },
            close: { [weak self] in self?.hide() }))
        panel.contentView = host
        panel.onKey = { [weak self] e in self?.handle(e) ?? false }
        panel.onPaste = { [weak self] in self?.pasteLines() ?? false }
    }

    var isVisible: Bool { panel.isVisible }

    func toggle() { panel.isVisible ? hide() : show() }

    /// Redraw in the new language if the bar happens to be open.
    func refreshLanguage() { model.objectWillChange.send() }

    func show() {
        model.refresh()
        Log.write("overlay show: groups=\(model.groups.count) later=\(model.later.count) prev=\(model.prev != nil)")
        let size = host.fittingSize
        let mouse = NSEvent.mouseLocation
        let screen = NSScreen.screens.first { $0.frame.contains(mouse) } ?? NSScreen.main!
        let vf = screen.visibleFrame
        let frame = NSRect(x: vf.midX - size.width / 2, y: vf.minY + 60, width: size.width, height: size.height)
        panel.setFrame(frame.offsetBy(dx: 0, dy: -14), display: false)
        panel.alphaValue = 0
        panel.makeKeyAndOrderFront(nil)
        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = 0.22
            ctx.timingFunction = CAMediaTimingFunction(controlPoints: 0.2, 1.2, 0.4, 1)
            panel.animator().alphaValue = 1
            panel.animator().setFrame(frame, display: true)
        }
    }

    func hide() {
        guard panel.isVisible else { return }
        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = 0.14
            panel.animator().alphaValue = 0
        }, completionHandler: { [weak self] in self?.panel.orderOut(nil) })
    }

    func windowDidResignKey(_ notification: Notification) { hide() }

    // ── actions ────────────────────────────────────────────────────
    private func openMain() { hide(); Engine.shared.showMain() }

    private func jump(_ c: Crumb) {
        hide()
        Jumper.jump(to: c)
    }

    private func delete(_ g: Store.TrailGroup) {
        Store.shared.remove(ids: Set(g.items.map(\.id)))
        g.items.forEach { Engine.shared.forget($0.link) }
        model.groups.removeAll { $0.id == g.id }
        model.selected = min(model.selected, max(0, model.groups.count - 1))
        resize()
    }

    private func toggle(_ g: Store.TrailGroup) {
        if model.expanded.contains(g.id) { model.expanded.remove(g.id) } else { model.expanded.insert(g.id) }
        resize()
    }

    private func saveNote() {
        if let id = model.current?.id { Store.shared.setNote(model.note, for: id) }
        hide()
    }

    /// Pasting several lines into 等一下要做 lists them one per row; Enter adds them all.
    private func pasteLines() -> Bool {
        guard model.focus == .later, let s = NSPasteboard.general.string(forType: .string) else { return false }
        let lines = Engine.splitLines(s)
        guard lines.count > 1 else { return false }
        model.pasted += lines
        resize()
        return true
    }

    private func fixBrowser() {
        hide()
        NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation")!)
    }

    private func addLater() {
        Engine.shared.addLater(lines: model.pasted + Engine.splitLines(model.laterText))
        model.pasted = []
        model.laterText = ""
        model.later = Engine.shared.later
        resize()
    }

    private func openLater(_ l: Engine.Later) {
        guard let s = l.url, let u = URL(string: s) else { return }
        hide()
        NSWorkspace.shared.open(u)
    }

    private func doneLater(_ l: Engine.Later) {
        Engine.shared.completeLater(l.id)
        model.later.removeAll { $0.id == l.id }
        resize()
    }

    private func resize() {
        DispatchQueue.main.async { [self] in
            let size = host.fittingSize
            var f = panel.frame
            f.origin.x += (f.width - size.width) / 2
            f.size = size
            panel.setFrame(f, display: true, animate: true)
        }
    }

    private func handle(_ e: NSEvent) -> Bool {
        switch e.keyCode {
        case 53: // esc
            if !model.pasted.isEmpty { model.pasted = []; resize() }
            else if model.focus != .list { model.focus = .list } else { hide() }
            return true
        case 48: // tab: list → 這頁要做什麼 → 等一下要做 → list
            model.focus = model.focus == .list ? .note : model.focus == .note ? .later : .list
            return true
        case 31 where e.modifierFlags.contains(.command): // ⌘O → main page
            openMain()
            return true
        default: break
        }
        if model.focus != .list { return false }
        let gs = model.groups
        switch e.keyCode {
        case 125: model.selected = min(model.selected + 1, max(0, gs.count - 1)); return true   // ↓
        case 126: model.selected = max(model.selected - 1, 0); return true                       // ↑
        case 124: if gs.indices.contains(model.selected) { toggle(gs[model.selected]) }; return true // → expand
        case 36, 76: if gs.indices.contains(model.selected) { jump(gs[model.selected].head) }; return true
        case 51, 117: if gs.indices.contains(model.selected) { delete(gs[model.selected]) }; return true
        default:
            // Start typing → it goes into "這頁要做什麼".
            if let ch = e.characters, !ch.isEmpty, e.modifierFlags.intersection([.command, .control]).isEmpty,
               ch.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) }) {
                model.focus = .note
            }
            return false
        }
    }
}

// ── SwiftUI content ──────────────────────────────────────────────────────────

private let crumbOrange = Color(red: 0.85, green: 0.47, blue: 0.17)

private func fmtDur(_ s: Double) -> String {
    let m = Int((s / 60).rounded())
    if m < 1 { return L("不到 1 分", "<1 min") }
    if m < 60 { return L("\(m) 分", "\(m) min") }
    return m % 60 == 0 ? L("\(m / 60) 小時", "\(m / 60) hr") : L("\(m / 60) 小時 \(m % 60) 分", "\(m / 60) hr \(m % 60) min")
}

private let clockFmt: DateFormatter = { let f = DateFormatter(); f.dateFormat = "HH:mm"; return f }()
private func clock(_ d: Date) -> String { clockFmt.string(from: d) }
private func hourLabel(_ d: Date) -> String {
    let h = Calendar.current.component(.hour, from: d)
    let day = Calendar.current.isDateInToday(d) ? "" : L("昨天 ", "Yesterday, ")
    return day + L((h < 12 ? "上午" : h < 18 ? "下午" : "晚上") + " \(h % 12 == 0 ? 12 : h % 12) 點",
                   "\(h % 12 == 0 ? 12 : h % 12) \(h < 12 ? "AM" : "PM")")
}

private var iconCache: [String: NSImage] = [:]
private func appIcon(_ bid: String) -> NSImage {
    if let i = iconCache[bid] { return i }
    let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bid)
    let img = url.map { NSWorkspace.shared.icon(forFile: $0.path) } ?? NSImage(systemSymbolName: "app", accessibilityDescription: nil)!
    iconCache[bid] = img
    return img
}

struct VisualEffect: NSViewRepresentable {
    func makeNSView(context: Context) -> NSVisualEffectView {
        let v = NSVisualEffectView()
        v.material = .hudWindow
        v.blendingMode = .behindWindow
        v.state = .active
        return v
    }
    func updateNSView(_ nsView: NSVisualEffectView, context: Context) {}
}

struct OverlayView: View {
    @ObservedObject var model: OverlayModel
    var jump: (Crumb) -> Void
    var deleteGroup: (Store.TrailGroup) -> Void
    var toggle: (Store.TrailGroup) -> Void
    var saveNote: () -> Void
    var addLater: () -> Void
    var openLater: (Engine.Later) -> Void
    var doneLater: (Engine.Later) -> Void
    var openMain: () -> Void
    var fixBrowser: () -> Void
    var close: () -> Void
    @FocusState private var focused: OverlayFocus?

    private var sparrow: NSImage { NSImage(named: "sparrow") ?? NSImage(systemSymbolName: "bird", accessibilityDescription: nil)! }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            header
            if model.browserDenied {
                Button(action: fixBrowser) {
                    Text(L("⚠️ 讀不到瀏覽器分頁，關掉的網頁不會自動離開清單。點這裡到「自動化」打開 Crumbs → Chrome",
                           "⚠️ Can't read browser tabs, so closed pages won't leave the list. Click to allow Crumbs → Chrome under Automation"))
                        .font(.system(size: 12)).multilineTextAlignment(.leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 10).padding(.vertical, 6)
                        .background(Color.orange.opacity(0.16), in: RoundedRectangle(cornerRadius: 9))
                }
                .buttonStyle(.plain)
            }
            if let n = model.prev?.note, !n.isEmpty {
                Text(L("你說過要：", "You said: ") + n)
                    .font(.system(size: 12.5))
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .background(crumbOrange.opacity(0.16), in: RoundedRectangle(cornerRadius: 9))
            }
            field(.note, icon: "pencil", text: $model.note,
                  placeholder: model.current.map { L("在「\($0.subject)」要做什麼？", "What to do in “\(Lang.subject($0.subject))”?") } ?? L("這裡要做什麼？", "What to do here?"), submit: saveNote)
            laterSection
            if !model.groups.isEmpty { trailSection }
            Text(L("↑↓ 選擇 · Enter 跳回去 · → 展開 · ⌫ 刪除 · Tab 切換輸入框 · ⌘O 主頁", "↑↓ select · Enter jump back · → expand · ⌫ delete · Tab switch field · ⌘O main window"))
                .font(.system(size: 10.5))
                .foregroundStyle(.tertiary)
                .frame(maxWidth: .infinity, alignment: .center)
        }
        .padding(16)
        .frame(width: 560)
        .background(VisualEffect())
        // Double-click anywhere on the bar's background → main page.
        .background(Color.clear.contentShape(Rectangle()).onTapGesture(count: 2) { openMain() })
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(.white.opacity(0.12)))
        .onChange(of: model.focus) { _, v in focused = v == .list ? nil : v }
        .onChange(of: focused) { _, v in model.focus = v ?? .list }
    }

    // ── 剛剛你在 ───────────────────────────────────────────────────
    private var header: some View {
        HStack(spacing: 10) {
            Image(nsImage: sparrow).resizable().interpolation(.high).frame(width: 40, height: 40)
            VStack(alignment: .leading, spacing: 1) {
                Text(model.prev == nil ? L("你現在在", "You're on") : L("剛剛你在", "You were just")).font(.system(size: 11)).foregroundStyle(.secondary)
                if let c = model.prev ?? model.current {
                    (Text(Lang.verb(c.verb)).fontWeight(.semibold).foregroundColor(crumbOrange) + Text(" · " + Lang.subject(c.subject)))
                        .font(.system(size: 15)).lineLimit(1)
                } else {
                    Text(L("還沒有足跡，切換幾個 App 就會開始記", "No crumbs yet — switch between a few apps to start")).font(.system(size: 14))
                }
            }
            Spacer(minLength: 8)
            if let p = model.prev {
                Text(fmtDur(Store.shared.liveSec(p))).font(.system(size: 12)).monospacedDigit().foregroundStyle(.secondary)
            }
            Button(action: openMain) {
                HStack(spacing: 4) {
                    Text(L("打開主頁", "Open"))
                    Image(systemName: "arrow.up.left.and.arrow.down.right").font(.system(size: 10, weight: .bold))
                }
                .font(.system(size: 12, weight: .semibold))
                .padding(.horizontal, 10).padding(.vertical, 5)
                .background(crumbOrange.opacity(0.9), in: Capsule())
                .foregroundStyle(.white)
            }
            .buttonStyle(.plain)
            .help(L("接下來、足跡、罐子、一週回顧（⌘O）", "Up next, trail, jar, weekly review (⌘O)"))
        }
        .contentShape(Rectangle())
        .onTapGesture(count: 2) { openMain() }
    }

    private func field(_ which: OverlayFocus, icon: String, text: Binding<String>, placeholder: String, submit: @escaping () -> Void) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon).font(.system(size: 12)).foregroundStyle(.secondary).frame(width: 14)
            TextField(placeholder, text: text)
                .textFieldStyle(.plain)
                .font(.system(size: 13.5))
                .focused($focused, equals: which)
                .onSubmit(submit)
        }
        .padding(.horizontal, 10).padding(.vertical, 8)
        .background(Color.primary.opacity(model.focus == which ? 0.1 : 0.05), in: RoundedRectangle(cornerRadius: 10))
    }

    // ── 等一下要做 ─────────────────────────────────────────────────
    private var laterSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            sectionTitle(L("等一下要做", "Later"), trailing: model.later.isEmpty ? nil : "\(model.later.count)")
            ForEach(model.later.prefix(4)) { l in
                HStack(spacing: 8) {
                    Button { doneLater(l) } label: {
                        Image(systemName: "circle").font(.system(size: 13)).foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                    .help(L("做完了", "Done"))
                    Text(l.title).font(.system(size: 13)).lineLimit(1)
                    Spacer(minLength: 4)
                    if l.url != nil {
                        Image(systemName: "arrow.up.right.square").font(.system(size: 12)).foregroundStyle(.secondary)
                    }
                }
                .padding(.horizontal, 8).padding(.vertical, 4)
                .background(model.hover == l.id ? Color.primary.opacity(0.06) : .clear, in: RoundedRectangle(cornerRadius: 8))
                .contentShape(Rectangle())
                .onHover { model.hover = $0 ? l.id : nil }
                .onTapGesture { openLater(l) }
            }
            if model.later.count > 4 {
                Text(L("還有 \(model.later.count - 4) 件，在主頁「接下來」", "\(model.later.count - 4) more in “Up next” on the main window")).font(.system(size: 11)).foregroundStyle(.tertiary).padding(.leading, 8)
            }
            field(.later, icon: "plus", text: $model.laterText, placeholder: L("等一下要做…（可以一次貼好幾行，或還沒點開的網址）", "Do later… (paste several lines, or a link you haven't opened)"), submit: addLater)
            if !model.pasted.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(Array(model.pasted.enumerated()), id: \.offset) { _, line in
                        HStack(spacing: 8) {
                            Image(systemName: "plus.circle").font(.system(size: 12)).foregroundStyle(crumbOrange)
                            Text(line).font(.system(size: 13)).lineLimit(1)
                        }
                        .padding(.horizontal, 8).padding(.vertical, 3)
                    }
                    Text(L("按 Enter 加入這 \(model.pasted.count) 項 · Esc 取消", "Enter adds these \(model.pasted.count) · Esc cancels"))
                        .font(.system(size: 11)).foregroundStyle(.secondary).padding(.leading, 8).padding(.top, 2)
                }
                .padding(.vertical, 4)
                .background(crumbOrange.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
            }
        }
    }

    // ── 過去 24 小時 ───────────────────────────────────────────────
    private var trailSection: some View {
        VStack(alignment: .leading, spacing: 2) {
            sectionTitle(L("過去 24 小時", "Last 24 hours"), trailing: nil)
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 2) {
                        ForEach(Array(model.groups.enumerated()), id: \.element.id) { i, g in
                            if i == 0 || Calendar.current.component(.hour, from: model.groups[i - 1].head.startedAt) != Calendar.current.component(.hour, from: g.head.startedAt) {
                                Text(hourLabel(g.head.startedAt))
                                    .font(.system(size: 11, weight: .semibold)).foregroundStyle(.tertiary)
                                    .padding(.top, i == 0 ? 0 : 8).padding(.leading, 8).padding(.bottom, 2)
                            }
                            groupRow(g, i).id(g.id)
                        }
                    }
                }
                .frame(height: model.trailHeight)
                .onChange(of: model.selected) { _, i in
                    if model.groups.indices.contains(i) { withAnimation(.easeOut(duration: 0.15)) { proxy.scrollTo(model.groups[i].id, anchor: .center) } }
                }
            }
        }
    }

    private func groupRow(_ g: Store.TrailGroup, _ i: Int) -> some View {
        let c = g.head
        let sel = model.selected == i && model.focus == .list
        let pages = g.pages
        let open = model.expanded.contains(g.id)
        return VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                Image(nsImage: appIcon(c.bundleId)).resizable().frame(width: 20, height: 20)
                    .opacity(c.closed == true ? 0.5 : 1)
                (Text(Lang.verb(c.verb)).fontWeight(.medium) + Text(" · " + Lang.subject(c.subject)).foregroundColor(.primary.opacity(0.85)))
                    .font(.system(size: 13)).lineLimit(1)
                    .opacity(c.closed == true ? 0.6 : 1)
                if pages.count > 1 {
                    Button { toggle(g) } label: {
                        Text("＋\(pages.count - 1) " + L("頁", pages.count == 2 ? "page" : "pages") + " \(open ? "▴" : "▾")")
                            .font(.system(size: 10.5, weight: .bold))
                            .padding(.horizontal, 6).padding(.vertical, 1)
                            .background(crumbOrange.opacity(0.22), in: Capsule())
                    }
                    .buttonStyle(.plain)
                }
                if !c.note.isEmpty {
                    Text("— " + c.note).font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 6)
                Text(c.closed == true ? L("已關閉", "Closed") : fmtDur(g.totalSec)).font(.system(size: 11)).foregroundStyle(.tertiary).lineLimit(1)
                Text(clock(c.startedAt)).font(.system(size: 11)).monospacedDigit().foregroundStyle(.secondary)
                Button { deleteGroup(g) } label: {
                    Image(systemName: "xmark").font(.system(size: 9, weight: .bold)).frame(width: 18, height: 18)
                }
                .buttonStyle(.plain)
                .foregroundStyle(.primary)
                .opacity(model.hover == g.id || sel ? 0.55 : 0.15)
                .help(L("刪除這些足跡", "Delete these crumbs"))
            }
            .padding(.horizontal, 8).padding(.vertical, 6)
            .contentShape(Rectangle())
            .onTapGesture { jump(c) }
            if open {
                ForEach(pages.dropFirst(), id: \.id) { p in
                    HStack(spacing: 8) {
                        Text(clock(p.startedAt)).font(.system(size: 10.5)).monospacedDigit().foregroundStyle(.tertiary)
                        Text(Lang.subject(p.subject)).font(.system(size: 12.5)).lineLimit(1)
                        Spacer()
                    }
                    .padding(.leading, 38).padding(.vertical, 4)
                    .contentShape(Rectangle())
                    .onTapGesture { jump(p) }
                }
            }
        }
        .background(sel ? crumbOrange.opacity(0.18) : (model.hover == g.id ? Color.primary.opacity(0.06) : .clear),
                    in: RoundedRectangle(cornerRadius: 9))
        .onHover { model.hover = $0 ? g.id : (model.hover == g.id ? nil : model.hover) }
    }

    private func sectionTitle(_ t: String, trailing: String?) -> some View {
        HStack {
            Text(t).font(.system(size: 11.5, weight: .semibold)).foregroundStyle(.secondary)
            if let trailing { Text(trailing).font(.system(size: 11)).foregroundStyle(.tertiary) }
            Spacer()
        }
        .padding(.leading, 2).padding(.top, 2)
    }
}
