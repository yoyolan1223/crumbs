// What are you doing in this window? (Same spirit as the Chrome extension's shared.js rules.)
import Foundation

enum Describe {
    struct Out { let key: String; let verb: String; let subject: String }

    static let browsers: Set<String> = [
        "com.google.Chrome", "com.google.Chrome.beta", "com.google.Chrome.canary", "com.brave.Browser",
        "com.microsoft.edgemac", "company.thebrowser.Browser", "com.vivaldi.Vivaldi", "com.apple.Safari",
    ]

    // bundle id prefix → verb
    private static let apps: [(String, String)] = [
        ("com.microsoft.Word", "寫文件"), ("com.apple.iWork.Pages", "寫文件"), ("com.microsoft.Powerpoint", "做簡報"),
        ("com.apple.iWork.Keynote", "做簡報"), ("com.microsoft.Excel", "整理表格"), ("com.apple.iWork.Numbers", "整理表格"),
        ("com.figma.Desktop", "做設計"), ("com.bohemiancoding.sketch3", "做設計"), ("com.adobe", "做設計"), ("com.canva", "做設計"),
        ("com.tinyspeck.slackmacgap", "回訊息"), ("jp.naver.line.mac", "回訊息"), ("net.whatsapp.WhatsApp", "回訊息"),
        ("com.facebook.archon", "回訊息"), ("ru.keepcoder.Telegram", "回訊息"), ("com.hnc.Discord", "回訊息"),
        ("com.apple.MobileSMS", "回訊息"), ("com.microsoft.teams", "回訊息"),
        ("com.apple.mail", "處理信件"), ("com.microsoft.Outlook", "處理信件"), ("com.readdle.smartemail", "處理信件"),
        ("com.apple.dt.Xcode", "寫程式"), ("com.microsoft.VSCode", "寫程式"), ("dev.zed.Zed", "寫程式"),
        ("com.todesktop.230313mzl4w4u92", "寫程式"), ("com.jetbrains", "寫程式"),
        ("com.apple.Terminal", "下指令"), ("com.googlecode.iterm2", "下指令"), ("dev.warp", "下指令"),
        ("notion.id", "寫筆記"), ("com.apple.Notes", "寫筆記"), ("md.obsidian", "寫筆記"), ("com.goodnotesapp", "寫筆記"),
        ("com.anthropic.claudefordesktop", "問 AI"), ("com.openai.chat", "問 AI"),
        ("com.apple.finder", "找檔案"), ("com.apple.Preview", "看文件"), ("com.adobe.Reader", "看文件"),
        ("com.spotify.client", "聽音樂"), ("com.apple.Music", "聽音樂"), ("us.zoom.xos", "開會"),
        ("com.apple.iCal", "看行程"), ("com.apple.reminders", "排任務"), ("com.apple.systempreferences", "改設定"),
    ]

    static func of(bundleId: String, app: String, title: String, url: String?) -> Out {
        if let url, browsers.contains(bundleId), let u = URL(string: url), let host = u.host {
            return web(u, host: host.replacingOccurrences(of: "www.", with: ""), title: title)
        }
        // A browser we couldn't ask for its URL (no permission yet) is still "browsing", not "using".
        let verb = browsers.contains(bundleId) ? "瀏覽" : (apps.first { bundleId.hasPrefix($0.0) }?.1 ?? "使用")
        let subject = clean(title, app: app)
        let key = bundleId + "|" + (subject == app ? "" : subject)
        return Out(key: key, verb: verb, subject: subject)
    }

    private static func web(_ u: URL, host: String, title: String) -> Out {
        let path = u.path
        let seg = path.split(separator: "/").map(String.init)
        let subject = clean(title, app: host)
        func q() -> String {
            (URLComponents(url: u, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "q" || $0.name == "v" }?.value ?? "")
                .replacingOccurrences(of: "+", with: " ")
        }
        if host.contains("mail.google.com") || host.contains("outlook.") { return Out(key: "web|mail", verb: "處理信件", subject: subject) }
        if host == "docs.google.com" {
            let k = "web|" + host + "/" + seg.prefix(3).joined(separator: "/")
            let verb = path.hasPrefix("/presentation") ? "做簡報" : path.hasPrefix("/spreadsheets") ? "整理表格" : "寫文件"
            return Out(key: k, verb: verb, subject: subject)
        }
        if host.hasSuffix("github.com") { return Out(key: "web|github/" + seg.prefix(2).joined(separator: "/"), verb: "寫程式", subject: subject) }
        if host.contains("google.") && path == "/search" { return Out(key: "web|q:" + q(), verb: "搜尋", subject: "「\(q())」") }
        if host.hasSuffix("youtube.com") { return Out(key: path == "/watch" ? "web|yt:" + q() : "web|youtube", verb: "看影片", subject: subject) }
        if host.contains("figma.com") || host.contains("canva.com") { return Out(key: "web|" + host + "/" + seg.prefix(3).joined(separator: "/"), verb: "做設計", subject: subject) }
        if host.contains("notion.") { return Out(key: "web|" + host + path, verb: "寫筆記", subject: subject) }
        if host.contains("claude.ai") || host.contains("chatgpt.com") || host.contains("gemini.google") { return Out(key: "web|" + host + path, verb: "問 AI", subject: subject) }
        for s in ["facebook.com", "instagram.com", "threads.", "x.com", "twitter.com", "dcard.tw", "ptt.cc", "reddit.com", "linkedin.com"] where host.contains(s) {
            return Out(key: "web|site:" + s, verb: "滑社群", subject: subject)
        }
        for s in ["shopee.tw", "momoshop", "pchome", "amazon."] where host.contains(s) { return Out(key: "web|site:" + s, verb: "逛購物", subject: subject) }
        return Out(key: "web|" + host + "/" + (seg.first ?? ""), verb: "瀏覽", subject: subject)
    }

    private static let separator = try! Regex(#"\s+[-|–—·•]\s+"#)

    /// "Q3 提案 - Google 文件 - Google Chrome - Yolanda" → "Q3 提案"
    static func clean(_ raw: String, app: String) -> String {
        var t = raw.trimmingCharacters(in: .whitespaces)
        for suffix in [" — 已編輯", " — Edited", " - 已編輯"] where t.hasSuffix(suffix) { t = String(t.dropLast(suffix.count)) }
        // Split only on separators surrounded by spaces, so "e-mail" stays intact.
        var parts = t.split(separator: separator).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        while parts.count > 1, let last = parts.last, last.count <= 30 { parts.removeLast() }
        t = parts.joined(separator: " - ")
        if t.isEmpty || t == app { return app }
        return t.count > 48 ? String(t.prefix(47)) + "…" : t
    }
}
