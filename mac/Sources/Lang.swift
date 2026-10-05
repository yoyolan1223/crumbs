// Interface language: 中文 or English. The choice lives in the main page's state (settings.lang),
// so the menu bar, the ⌃⌃ bar and the web UI always agree; UserDefaults keeps a copy for launch.
import Foundation

/// Inline pair: L("今天", "Today").
func L(_ zh: String, _ en: String) -> String { Lang.isEN ? en : zh }

enum Lang {
    static let changed = Notification.Name("CrumbsLangChanged")

    /// "auto" | "zh" | "en"
    static var pref: String {
        get { UserDefaults.standard.string(forKey: "lang") ?? "auto" }
        set { UserDefaults.standard.set(newValue, forKey: "lang") }
    }

    /// The system language, for "auto" (also handed to the web UI).
    static var system: String {
        (Locale.preferredLanguages.first ?? "zh").hasPrefix("zh") ? "zh" : "en"
    }
    static var resolved: String { pref == "zh" || pref == "en" ? pref : system }
    static var isEN: Bool { resolved == "en" }

    /// Change the language; tells the menu, the overlay and the main page.
    static func set(_ p: String, fromWeb: Bool = false) {
        let p = ["zh", "en"].contains(p) ? p : "auto"
        guard p != pref else { return }
        pref = p
        if !fromWeb { Engine.shared.setLang(p) }
        NotificationCenter.default.post(name: changed, object: nil)
    }

    // Verbs are saved in Chinese (see Describe.swift); translate when shown.
    private static let verbs: [String: String] = [
        "寫文件": "Writing", "做簡報": "Slides", "整理表格": "Spreadsheets", "做設計": "Designing",
        "回訊息": "Messages", "處理信件": "Email", "寫程式": "Coding", "下指令": "Terminal", "寫筆記": "Notes",
        "問 AI": "Asking AI", "找檔案": "Files", "看文件": "Reading docs", "聽音樂": "Music", "開會": "Meeting",
        "看行程": "Calendar", "排任務": "Planning", "改設定": "Settings", "瀏覽": "Browsing", "使用": "Using",
        "搜尋": "Searching", "看影片": "Watching", "滑社群": "Social media", "逛購物": "Shopping",
    ]
    static func verb(_ s: String) -> String { isEN ? verbs[s] ?? s : s }

    /// 「query」 → “query” in English.
    static func subject(_ s: String) -> String {
        guard isEN, s.hasPrefix("「"), s.hasSuffix("」"), s.count >= 2 else { return s }
        return "“" + s.dropFirst().dropLast() + "”"
    }
}
