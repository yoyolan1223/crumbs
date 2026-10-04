// 麵包屑 for Mac — the one notebook for the whole computer.
import Foundation

struct Crumb: Codable, Identifiable, Equatable {
    var id: String
    var key: String          // what counts as "the same place"
    var bundleId: String
    var app: String
    var title: String        // raw window / tab title
    var url: String?
    var verb: String
    var subject: String
    var startedAt: Date
    var activeSec: Double
    var note: String
    var flick: Bool = false
    var closed: Bool? = nil   // its tab / window / app was closed (kept for the 24h history)

    /// One address for "this place", shared with the main page: the web URL, or app://<bundle>/<subject>?app=<name>.
    var link: String { url ?? Crumb.appLink(bundleId: bundleId, app: app, subject: subject) }

    static func appLink(bundleId: String, app: String, subject: String) -> String {
        let safe = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~")
        let s = subject == app ? "" : (subject.addingPercentEncoding(withAllowedCharacters: safe) ?? "")
        return "app://\(bundleId)/\(s)?app=\(app.addingPercentEncoding(withAllowedCharacters: safe) ?? "")"
    }
}

struct Meta: Codable {
    var app: String
    var bundleId: String
    var verb: String
    var subject: String
    var url: String?
}

private struct Saved: Codable {
    var crumbs: [Crumb] = []
    var days: [String: [String: Double]] = [:]   // "2026-10-1" → key → seconds (for the weekly view)
    var meta: [String: Meta] = [:]
}

final class Store: ObservableObject {
    static let shared = Store()

    @Published private(set) var crumbs: [Crumb] = []
    private(set) var currentId: String?
    private var since: Date?
    private var days: [String: [String: Double]] = [:]
    private var meta: [String: Meta] = [:]
    private var saveWork: DispatchWorkItem?

    let folder: URL = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("Crumbs", isDirectory: true)
    }()
    private var file: URL { folder.appendingPathComponent("crumbs.json") }

    private init() { load() }

    var current: Crumb? { crumbs.first { $0.id == currentId } }
    var isRunning: Bool { since != nil }

    // You are now looking at this window / tab.
    func visit(bundleId: String, app: String, title: String, url: String?) {
        let d = Describe.of(bundleId: bundleId, app: app, title: title, url: url)
        let now = Date()
        if let i = index(currentId), crumbs[i].key == d.key {
            // Same place: refresh the details, keep the clock running.
            crumbs[i].title = title
            crumbs[i].subject = d.subject
            crumbs[i].url = url ?? crumbs[i].url
            if since == nil { since = now }
            Engine.shared.visit(crumbs[i], at: now)
            return
        }
        closeCurrent(now)
        // Flicked through in under 1.5s? Not a real step.
        if let i = index(currentId), crumbs[i].activeSec < 1.5, crumbs[i].note.isEmpty { crumbs[i].flick = true }
        let c = Crumb(id: UUID().uuidString, key: d.key, bundleId: bundleId, app: app, title: title, url: url,
                      verb: d.verb, subject: d.subject, startedAt: now, activeSec: 0, note: "")
        crumbs.append(c)
        currentId = c.id
        since = now
        meta[d.key] = Meta(app: app, bundleId: bundleId, verb: d.verb, subject: d.subject, url: url)
        prune(now)
        scheduleSave()
        Engine.shared.visit(c, at: now)
    }

    // Stop the clock (idle, screen locked, sleeping). The crumb stays current.
    func pause() {
        let wasRunning = since != nil
        closeCurrent(Date())
        if wasRunning { Engine.shared.pause(at: Date()) }
    }

    func closeCurrent(_ now: Date) {
        guard let s = since, let i = index(currentId) else { since = nil; return }
        let dt = min(max(0, now.timeIntervalSince(s)), 2 * 3600)
        crumbs[i].activeSec += dt
        days[Self.dayKey(now), default: [:]][crumbs[i].key, default: 0] += dt
        since = nil
        scheduleSave()
    }

    func liveSec(_ c: Crumb) -> Double {
        c.activeSec + ((c.id == currentId && since != nil) ? Date().timeIntervalSince(since!) : 0)
    }

    /// Where you were just before the current place.
    func previous() -> Crumb? {
        let cur = current
        return crumbs.last { !$0.flick && $0.id != currentId && $0.key != cur?.key }
    }

    /// Recent distinct places, newest first, skipping where you are now.
    func recentPlaces(_ n: Int = 7) -> [Crumb] {
        var seen = Set<String>([current?.key ?? ""])
        var out: [Crumb] = []
        for c in crumbs.reversed() where !c.flick && c.closed != true && !seen.contains(c.key) {
            seen.insert(c.key)
            out.append(c)
            if out.count >= n { break }
        }
        return out
    }

    func setNote(_ note: String, for id: String) {
        guard let i = index(id) else { return }
        crumbs[i].note = note.trimmingCharacters(in: .whitespacesAndNewlines)
        if !crumbs[i].note.isEmpty { crumbs[i].flick = false }
        scheduleSave()
    }

    /// Forget a place (its footprints). Time already spent stays in the weekly history.
    func delete(key: String) {
        crumbs.removeAll { $0.key == key && $0.id != currentId }
        scheduleSave()
    }

    /// Forget places by their link (deleted on the main page).
    func remove(links: Set<String>) {
        crumbs.removeAll { links.contains($0.link) && $0.id != currentId }
        scheduleSave()
    }

    /// Drop places whose tab / window / app has been closed.
    /// openUrls is nil when we couldn't ask every running browser (then web places are left alone).
    func removeClosed(running: Set<String>, windows: [String: [String]], openUrls: Set<String>?) {
        func isClosed(_ c: Crumb) -> Bool {
            if c.id == currentId { return false }
            if Describe.browsers.contains(c.bundleId), let url = c.url {
                guard let open = openUrls else { return false }
                return !open.contains(url)
            }
            if !running.contains(c.bundleId) { return true }
            guard let titles = windows[c.bundleId], c.subject != c.app else { return false }
            return !titles.contains(c.subject)
        }
        var changed = false
        for i in crumbs.indices where crumbs[i].closed != true && isClosed(crumbs[i]) {
            crumbs[i].closed = true
            changed = true
        }
        if changed { scheduleSave() }
    }

    // ── 24h history, merged by site ────────────────────────────────
    struct TrailGroup: Identifiable {
        let items: [Crumb]           // newest first
        var id: String { items[0].id }
        var head: Crumb { items[0] }
        /// Distinct pages in the group (a page visited twice counts once).
        var pages: [Crumb] {
            var seen = Set<String>()
            return items.filter { seen.insert($0.subject).inserted }
        }
        var totalSec: Double { items.reduce(0) { $0 + Store.shared.liveSec($1) } }
    }

    /// Which site a footprint belongs to: app → the app; web → main domain (google.com products stay apart).
    static func groupKey(_ c: Crumb) -> String {
        guard let url = c.url, let host = URL(string: url)?.host?.replacingOccurrences(of: "www.", with: "") else {
            return "app:" + c.bundleId
        }
        if host.hasSuffix("google.com") { return "web:" + host }
        let p = host.split(separator: ".").map(String.init)
        let sld: Set<String> = ["com", "co", "org", "net", "gov", "edu", "ac", "or", "ne", "go"]
        let n = p.count >= 3 && sld.contains(p[p.count - 2]) && p[p.count - 1].count == 2 ? 3 : 2
        return "web:" + p.suffix(n).joined(separator: ".")
    }

    /// Footprints of the last `hours`, newest first; consecutive visits to the same site merged.
    func trail(hours: Double = 24) -> [TrailGroup] {
        let since = Date().addingTimeInterval(-hours * 3600)
        var groups: [[Crumb]] = []
        for c in crumbs.reversed() where !c.flick && c.id != currentId && c.startedAt >= since {
            if let last = groups.last?.first, Store.groupKey(last) == Store.groupKey(c),
               Calendar.current.component(.hour, from: last.startedAt) == Calendar.current.component(.hour, from: c.startedAt) {
                groups[groups.count - 1].append(c)
            } else {
                groups.append([c])
            }
        }
        return groups.map { TrailGroup(items: $0) }
    }

    func remove(ids: Set<String>) {
        crumbs.removeAll { ids.contains($0.id) && $0.id != currentId }
        scheduleSave()
    }

    // ── persistence ────────────────────────────────────────────────
    static func dayKey(_ d: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: d)
        return "\(c.year!)-\(c.month!)-\(c.day!)"
    }

    private func index(_ id: String?) -> Int? {
        guard let id else { return nil }
        return crumbs.lastIndex { $0.id == id }
    }

    private func prune(_ now: Date) {
        let keep = currentId
        crumbs = Array(crumbs.filter { $0.id == keep || now.timeIntervalSince($0.startedAt) < 48 * 3600 }.suffix(800))
        let cutoff = Calendar.current.date(byAdding: .day, value: -60, to: now)!
        days = days.filter { k, _ in
            let p = k.split(separator: "-").compactMap { Int($0) }
            guard p.count == 3, let d = Calendar.current.date(from: DateComponents(year: p[0], month: p[1], day: p[2])) else { return false }
            return d >= cutoff
        }
    }

    private func load() {
        guard let data = try? Data(contentsOf: file) else { return }
        let dec = JSONDecoder()
        dec.dateDecodingStrategy = .iso8601
        guard let s = try? dec.decode(Saved.self, from: data) else { return }
        crumbs = s.crumbs
        days = s.days
        meta = s.meta
    }

    func scheduleSave() {
        saveWork?.cancel()
        let w = DispatchWorkItem { [weak self] in self?.saveNow() }
        saveWork = w
        DispatchQueue.main.asyncAfter(deadline: .now() + 2, execute: w)
    }

    func saveNow() {
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let enc = JSONEncoder()
        enc.dateEncodingStrategy = .iso8601
        enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        let s = Saved(crumbs: crumbs, days: days, meta: meta)
        if let data = try? enc.encode(s) { try? data.write(to: file, options: .atomic) }
    }
}
