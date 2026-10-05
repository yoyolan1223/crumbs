// Ways to call the sparrow from any app.
//  1. Double-tap a modifier (default ⌃) — Typeless-style; needs the Accessibility permission we already ask for.
//  2. ⌃⌥Z                               — classic hotkey, no permission needed.
// Note: since macOS 15, hotkeys that use only ⌥ (or ⌥⇧) are refused by the system, so plain ⌥Z can't work.
import AppKit
import Carbon

final class Hotkey {
    private var ref: EventHotKeyRef?
    private static var action: (() -> Void)?
    private(set) var status: OSStatus = noErr

    init(keyCode: UInt32, modifiers: UInt32, action: @escaping () -> Void) {
        Hotkey.action = action
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, _, _ in
            DispatchQueue.main.async { Hotkey.action?() }
            return noErr
        }, 1, &spec, nil, nil)
        let id = EventHotKeyID(signature: OSType(0x43524D42), id: 1) // 'CRMB'
        status = RegisterEventHotKey(keyCode, modifiers, id, GetApplicationEventTarget(), 0, &ref)
        Log.write("hotkey ⌃⌥Z register status=\(status)")
    }

    deinit { if let ref { UnregisterEventHotKey(ref) } }

    static let controlOptionZ = (UInt32(kVK_ANSI_Z), UInt32(controlKey | optionKey))
}

/// Double-tap a modifier key (press + release twice within 0.4s, nothing else in between).
/// Which key is a user choice — Claude's desktop app already uses double-tap ⌥.
enum TapKey: String, CaseIterable {
    case control, rightOption, rightCommand, off

    var title: String {
        switch self {
        case .control: return L("連按兩下 ⌃ Control", "Double-tap ⌃ Control")
        case .rightOption: return L("連按兩下右邊的 ⌥ Option", "Double-tap right ⌥ Option")
        case .rightCommand: return L("連按兩下右邊的 ⌘ Command", "Double-tap right ⌘ Command")
        case .off: return L("不用連按（只用 ⌃⌥Z）", "No double-tap (⌃⌥Z only)")
        }
    }
    var short: String {
        switch self {
        case .control: return L("連按兩下 ⌃", "double-tap ⌃")
        case .rightOption: return L("連按兩下右 ⌥", "double-tap right ⌥")
        case .rightCommand: return L("連按兩下右 ⌘", "double-tap right ⌘")
        case .off: return "⌃⌥Z"
        }
    }
    // Hardware key codes: 59/62 = left/right ⌃, 61 = right ⌥, 54 = right ⌘
    fileprivate var keyCodes: Set<UInt16> {
        switch self {
        case .control: return [59, 62]
        case .rightOption: return [61]
        case .rightCommand: return [54]
        case .off: return []
        }
    }
    fileprivate var flag: NSEvent.ModifierFlags {
        switch self {
        case .control: return .control
        case .rightOption: return .option
        case .rightCommand: return .command
        case .off: return []
        }
    }

    static var saved: TapKey {
        get { TapKey(rawValue: UserDefaults.standard.string(forKey: "tapKey") ?? "") ?? .control }
        set { UserDefaults.standard.set(newValue.rawValue, forKey: "tapKey") }
    }
}

final class DoubleTap {
    private var monitors: [Any] = []
    private var downAt: TimeInterval?
    private var lastTapAt: TimeInterval = 0
    private var dirty = false   // another key/modifier was involved → not a clean tap
    private let action: () -> Void
    var key: TapKey { didSet { downAt = nil; lastTapAt = 0 } }

    init(key: TapKey, action: @escaping () -> Void) {
        self.key = key
        self.action = action
        let flags: (NSEvent) -> Void = { [weak self] e in self?.flagsChanged(e) }
        let keys: (NSEvent) -> Void = { [weak self] _ in self?.dirty = true; self?.lastTapAt = 0 }
        // Global monitors see other apps (needs Accessibility); local ones see our own floating bar.
        if let m = NSEvent.addGlobalMonitorForEvents(matching: .flagsChanged, handler: flags) { monitors.append(m) }
        if let m = NSEvent.addGlobalMonitorForEvents(matching: .keyDown, handler: keys) { monitors.append(m) }
        if let m = NSEvent.addLocalMonitorForEvents(matching: .flagsChanged, handler: { e in flags(e); return e }) { monitors.append(m) }
        if let m = NSEvent.addLocalMonitorForEvents(matching: .keyDown, handler: { e in keys(e); return e }) { monitors.append(m) }
        Log.write("double-tap monitors installed key=\(key.rawValue) (accessibility trusted=\(AX.trusted))")
    }

    deinit { monitors.forEach(NSEvent.removeMonitor) }

    private func flagsChanged(_ e: NSEvent) {
        guard key != .off else { return }
        let f = e.modifierFlags.intersection(.deviceIndependentFlagsMask).subtracting([.capsLock, .function, .numericPad])
        let now = e.timestamp
        if f == key.flag && key.keyCodes.contains(e.keyCode) {
            if downAt == nil { downAt = now; dirty = false }
        } else if f.isEmpty, let down = downAt, key.keyCodes.contains(e.keyCode) {
            downAt = nil
            guard !dirty, now - down < 0.3 else { lastTapAt = 0; return }
            if now - lastTapAt < 0.4 {
                lastTapAt = 0
                DispatchQueue.main.async { self.action() }
            } else {
                lastTapAt = now
            }
        } else {
            // The key was combined with something else, or a different modifier → not our gesture.
            dirty = true
            downAt = nil
            lastTapAt = 0
        }
    }
}

enum Log {
    static func write(_ s: String) {
        let url = Store.shared.folder.appendingPathComponent("debug.log")
        try? FileManager.default.createDirectory(at: Store.shared.folder, withIntermediateDirectories: true)
        let line = "\(ISO8601DateFormatter().string(from: Date())) \(s)\n"
        if let h = try? FileHandle(forWritingTo: url) {
            h.seekToEndOfFile(); h.write(line.data(using: .utf8)!); try? h.close()
        } else {
            try? line.data(using: .utf8)!.write(to: url)
        }
    }
}
