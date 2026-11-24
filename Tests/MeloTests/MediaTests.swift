// Settings persistence, the LRCLIB request and response trimming, sign-out clearing the queue, and the
// settings, lyrics and app bridge messages.
import Foundation
import Testing

@testable import Melo

@MainActor @Suite struct SettingsStoreTests {
  let suite = "melo-settings-test-\(UUID().uuidString)"

  @Test func defaultsMatchTheMockup() throws {
    let defaults = try #require(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    #expect(SettingsStore(defaults: defaults).value == AppSettings())
    #expect(AppSettings() == AppSettings(theme: .system, lyricsFromLrclib: true, menuBarItem: true, miniPlayer: false, mediaKeys: true))
  }

  @Test func patchesPersistAndReportChanges() throws {
    let defaults = try #require(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    let store = SettingsStore(defaults: defaults)
    var reported: [AppSettings] = []
    store.onChange = { reported.append($0) }
    store.apply(SettingsPatch(theme: .dark, lyricsFromLrclib: false))
    store.apply(SettingsPatch(miniPlayer: true, mediaKeys: false))
    store.apply(SettingsPatch(miniPlayer: true))  // no change, no report
    let expected = AppSettings(theme: .dark, lyricsFromLrclib: false, menuBarItem: true, miniPlayer: true, mediaKeys: false)
    #expect(store.value == expected)
    #expect(reported.count == 2)
    #expect(SettingsStore(defaults: defaults).value == expected)
  }

  @Test func ignoresAnUnknownStoredTheme() throws {
    let defaults = try #require(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    defaults.set("sepia", forKey: "settings.theme")
    #expect(SettingsStore(defaults: defaults).value.theme == .system)
  }
}

@Suite struct LrclibTests {
  @Test func buildsASearchOnTheFixedHost() throws {
    let request = Lrclib.request(LrclibParams(title: "Song & Title", artist: "Some Artist", durationSec: 200))
    let url = try #require(request.url)
    #expect(url.scheme == "https" && url.host == "lrclib.net" && url.path == "/api/search")
    let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems
    #expect(items == [URLQueryItem(name: "track_name", value: "Song & Title"), URLQueryItem(name: "artist_name", value: "Some Artist")])
    #expect(url.absoluteString.contains("Song%20%26%20Title"))
    #expect(request.value(forHTTPHeaderField: "User-Agent") == "Melo/0.1 (macOS YouTube Music client)")
    #expect(request.value(forHTTPHeaderField: "Cookie") == nil)
    #expect(request.timeoutInterval == 8)
    #expect(request.httpShouldHandleCookies == false)
  }

  @Test func trimsToTheNeededFields() throws {
    let json = """
      [
        {"id": 1, "trackName": "T", "artistName": "A", "albumName": "B", "duration": 201.5, "instrumental": false,
         "plainLyrics": "Placeholder line 1", "syncedLyrics": "[00:01.00] Placeholder line 1"},
        {"id": 2, "duration": 200, "instrumental": true, "plainLyrics": null, "syncedLyrics": null},
        {"id": 3, "duration": 199, "instrumental": false, "plainLyrics": "  ", "syncedLyrics": ""},
        {"id": 4, "duration": 198, "plainLyrics": "Placeholder line 2"},
        {"id": 5, "plainLyrics": "No duration"}
      ]
      """
    let results = try Lrclib.trim(Data(json.utf8))
    #expect(results == [
      LrclibResult(durationSec: 201.5, plainLyrics: "Placeholder line 1", syncedLyrics: "[00:01.00] Placeholder line 1"),
      LrclibResult(durationSec: 198, plainLyrics: "Placeholder line 2"),
    ])
    let encoded = try #require(try JSONSerialization.jsonObject(with: JSONEncoder().encode(results[0])) as? [String: Any])
    #expect(Set(encoded.keys) == ["durationSec", "plainLyrics", "syncedLyrics"])
  }

  @Test func rejectsANonArrayResponse() {
    #expect(throws: DecodingError.self) { try Lrclib.trim(Data("{\"error\":1}".utf8)) }
  }
}

@MainActor @Suite struct SignOutQueueTests {
  @Test func clearEmptiesTheQueueAndDeletesTheSavedFile() async throws {
    let url = FileManager.default.temporaryDirectory.appending(path: "melo-clear-test-\(UUID().uuidString)/queue.json")
    defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let store = QueueStore(url: url)
    let player = FakePlayer()
    let queue = Queue(player: player, store: store)
    queue.setAutoplay(false)
    var events: [Event] = []
    queue.onEvent = { events.append($0) }
    try await queue.set(items("a", "b"), at: 0, source: QueueSource(title: "Album"), continuation: nil)
    queue.save()
    #expect(store.load() != nil)

    await queue.clear()
    #expect(queue.state.entries.isEmpty && queue.state.index == -1 && queue.state.source == nil)
    #expect(queue.state.autoplay == false)  // a setting, kept
    #expect(player.calls.last == "pause")
    #expect(store.load() == nil)
    #expect(FileManager.default.fileExists(atPath: url.path) == false)
    guard case .queueChanged(let snapshot) = events.last else { Issue.record("no queue.changed"); return }
    #expect(snapshot.items.isEmpty && snapshot.index == -1)

    let restored = FakePlayer()
    Queue(player: restored, store: store).restore()
    #expect(restored.calls == ["home"])
  }
}

@Suite struct MediaProtocolTests {
  func decode(_ body: Any) throws -> Request {
    try JSONDecoder().decode(Request.self, from: JSONSerialization.data(withJSONObject: body))
  }

  @Test func decodesSettingsRequests() throws {
    #expect(try decode(["method": "settings.get", "params": [:]]) == .settingsGet)
    #expect(
      try decode(["method": "settings.set", "params": ["theme": "dark", "miniPlayer": true]])
        == .settingsSet(SettingsPatch(theme: .dark, miniPlayer: true)))
    #expect(throws: DecodingError.self) { try decode(["method": "settings.set", "params": ["theme": "sepia"]]) }
    #expect(throws: DecodingError.self) { try decode(["method": "settings.set", "params": ["mediaKeys": "yes"]]) }
  }

  @Test func decodesLyricsAndAppRequests() throws {
    #expect(
      try decode(["method": "lyrics.lrclib", "params": ["title": "T", "artist": "A", "durationSec": 180]])
        == .lyricsLrclib(LrclibParams(title: "T", artist: "A", durationSec: 180)))
    #expect(throws: DecodingError.self) { try decode(["method": "lyrics.lrclib", "params": ["title": "T"]]) }
    #expect(try decode(["method": "app.showWindow", "params": [:]]) == .appShowWindow)
    #expect(try decode(["method": "app.quit", "params": [:]]) == .appQuit)
  }

  @Test func decodesNavStateAndRejectsSatellites() throws {
    let request = try decode(["method": "nav.state", "params": ["canGoBack": true, "canGoForward": false]])
    #expect(request == .navState(NavState(canGoBack: true, canGoForward: false)))
    #expect(throws: DecodingError.self) { try decode(["method": "nav.state", "params": ["canGoBack": true]]) }
    #expect(!Bridge.satelliteMay(request))
  }

  @MainActor @Test func encodesNavGo() throws {
    let event = try #require(try Bridge.json(Event.navGo(NavGo(direction: .back))) as? [String: Any])
    #expect(event["name"] as? String == "nav.go")
    #expect((event["payload"] as? [String: Any])?["direction"] as? String == "back")
  }

  @MainActor @Test func encodesSettingsChanged() throws {
    let event = try #require(try Bridge.json(Event.settingsChanged(AppSettings())) as? [String: Any])
    #expect(event["name"] as? String == "settings.changed")
    let payload = try #require(event["payload"] as? [String: Any])
    #expect(payload["theme"] as? String == "system")
    #expect(payload["menuBarItem"] as? Bool == true)
  }
}
