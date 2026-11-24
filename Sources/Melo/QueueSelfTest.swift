// MELO_QUEUE_SELFTEST=1 (or <videoId>,<videoId>,<videoId>): queues three public tracks and plays them anonymously at
// volume 0 with the window hidden, then prints one line per check and quits. It seeks near the end of each track and
// proves the queue advances exactly once per track, ignores duplicate and late `ended` states, stops at the end of
// the queue, and handles Previous, repeat one, and a save and restore. It saves to a temporary file, and also times
// a round trip into the hidden UI web view, since radio fetching for autoplay runs there.
import Foundation
import WebKit

@MainActor
enum QueueSelfTest {
  static let defaultIds = ["7qQg6YbSMko", "udWzGOcAy2g", "XX4EpkR-Sp4"]
  static let store = QueueStore(url: FileManager.default.temporaryDirectory.appending(path: "melo-queue-selftest.json"))

  /// Forwards to the real player and records every load, so the test can count advances.
  final class CountingPlayer: QueuePlayer {
    let player: Player
    private(set) var loads: [String] = []
    init(_ player: Player) { self.player = player }
    var state: PlayerState { player.state }
    var generation: Int { player.generation }
    func load(_ params: LoadParams) async {
      loads.append(params.videoId)
      let before = player.generation
      await player.load(params)
      describeLoad(params.videoId, fullLoad: player.generation != before)
    }
    func cue(_ params: LoadParams, at seconds: Double) {
      loads.append("cue:\(params.videoId)")
      player.cue(params, at: seconds)
      describeLoad(params.videoId, fullLoad: true)
    }

    /// Prints how a load reached the page and whether that page was signed in and carried ads, once the page reports
    /// the track (or after 15 s), so a load that shows an ad explains itself. A full load includes the router's
    /// fallback. The router path is decided by the time `load` returns, except for a fallback after the 10 s timeout,
    /// which `Router did not confirm` in the player log records.
    private func describeLoad(_ videoId: String, fullLoad: Bool) {
      Task { @MainActor [player] in
        var tries = 0
        while tries < 150, player.state.videoId != videoId || player.state.status == .loading && !player.state.isAd {
          try? await Task.sleep(for: .milliseconds(100))
          tries += 1
        }
        print("queue-selftest load \(videoId) via \(fullLoad ? "full load" : "router") \(await QueueSelfTest.account(player.webView))")
      }
    }
    func preloadHome() { player.preloadHome() }
    func play() async throws { try await player.play() }
    func pause() async throws { try await player.pause() }
    func seek(_ seconds: Double) async throws { try await player.seek(seconds) }
  }

  /// The page's sign-in and ad state, booleans and counts only: `LOGGED_IN` from ytcfg, the current player response's
  /// ad placements, and whether an ad shows.
  static func account(_ webView: WKWebView) async -> String {
    let script = """
      const value = window.ytcfg && window.ytcfg.data_ ? window.ytcfg.data_.LOGGED_IN : undefined;
      const api = document.getElementById('movie_player');
      const response = api && api.getPlayerResponse ? api.getPlayerResponse() : null;
      const placements = response && Array.isArray(response.adPlacements) ? response.adPlacements.length : 0;
      const ad = !!api && (api.classList.contains('ad-showing') || api.classList.contains('ad-interrupting'));
      return `loggedIn=${typeof value === 'boolean' ? value : 'unknown'} adPlacements=${placements} ad=${ad}`;
      """
    let result = try? await webView.callAsyncJavaScript(script, contentWorld: .page)
    return result as? String ?? "unavailable"
  }

  /// The media element's own view, for diagnosing a stall.
  static func media(_ webView: WKWebView) async -> String {
    let script = """
      const v = document.querySelector('video');
      if (!v) return 'no video';
      const ranges = [];
      for (let i = 0; i < v.buffered.length; i++) ranges.push([v.buffered.start(i), v.buffered.end(i)]);
      return JSON.stringify({ time: v.currentTime, duration: v.duration, paused: v.paused, ended: v.ended,
        readyState: v.readyState, networkState: v.networkState, buffered: ranges, volume: v.volume });
      """
    let result = try? await webView.callAsyncJavaScript(script, contentWorld: .page)
    return result as? String ?? "unavailable"
  }

  static func run(_ queue: Queue, player: Player, ui: WKWebView, videoIds ids: [String]) async -> Int32 {
    guard ids.count == 3, let counting = queue.player as? CountingPlayer else {
      print("queue-selftest FAILED: needs three ids and the counting player")
      return 1
    }
    try? FileManager.default.removeItem(at: store.url)
    var failures = 0
    func report(_ name: String, _ ok: Bool, _ detail: String = "") {
      print("queue-selftest \(ok ? "PASS" : "FAIL") \(name): \(detail) [index \(queue.state.index), loads \(counting.loads), \(PlayerSelfTest.describe(player.state))]")
      if !ok { failures += 1 }
    }
    // The test plays signed out, so YouTube Music may show ads; time spent in an ad does not count against a wait.
    func wait(_ seconds: Double, until condition: () -> Bool) async -> Bool {
      var waited = 0
      while waited < Int(seconds * 10) {
        if condition() { return true }
        try? await Task.sleep(for: .milliseconds(100))
        if !player.state.isAd { waited += 1 }
      }
      return condition()
    }
    func playing(_ id: String) -> Bool {
      player.state.status == .playing && player.state.videoId == id && !player.state.isAd && player.state.duration > 0
    }
    /// Seeks 3 s before the end and waits until the page reports it, so a stale state cannot satisfy the next wait.
    func nearEnd() async {
      let target = max(0, player.state.duration - 3)
      try? await player.seek(target)
      _ = await wait(10) { player.state.currentTime >= target - 1 }
    }

    var loudest = 0.0
    var events: [String] = []
    var statuses: [String] = []
    let sampler = Task {
      while !Task.isCancelled {
        if player.state.status == .playing, player.state.volume > loudest {
          loudest = player.state.volume
          statuses.append("LOUD(\(loudest))")
        }
        let entry = "\(player.state.status.rawValue):\(player.state.videoId ?? "-")"
        if statuses.last != entry { statuses.append(entry) }
        try? await Task.sleep(for: .milliseconds(50))
      }
    }
    defer { sampler.cancel() }
    let forward = queue.onEvent
    queue.onEvent = { event in
      switch event {
      case .queueChanged(let snapshot): events.append("changed:\(snapshot.index)")
      case .queueNeedsMore: events.append("needsMore")
      case .queueUnplayable(let unplayable): events.append("unplayable:\(unplayable.videoId)")
      default: break
      }
      forward?(event)
    }

    try? await player.setVolume(0)
    loudest = 0
    player.preloadHome()
    report("home-preload", await wait(30) { player.committed })

    queue.setAutoplay(false)
    let items = ids.enumerated().map { QueueItem(videoId: $1, title: "Track \($0 + 1)") }
    try? await queue.set(items, at: 0, source: QueueSource(title: "Queue self-test"), continuation: nil)
    report("first-playing", await wait(60) { playing(ids[0]) })

    // Track 1 -> 2 -> 3, one advance each.
    for step in 1..<3 {
      await nearEnd()
      let advanced = await wait(30) { playing(ids[step]) }
      try? await Task.sleep(for: .seconds(4))
      report(
        "advance-\(step)", advanced && counting.loads == Array(ids[0...step]) && queue.state.index == step && playing(ids[step]),
        "exactly one load per track")
    }

    // Late ended states for the tracks before must not skip. (Duplicates of a real end are covered by the advance
    // checks above and the unit tests: an injected end of the playing track is indistinguishable from a real one.)
    let before = counting.loads
    var late = player.state
    late.status = .ended
    for id in [ids[0], ids[1], ids[0]] {
      late.videoId = id
      await queue.handle(late)
    }
    report("late-ended-ignored", counting.loads == before && queue.state.index == 2)

    // Repeat one restarts the same track once, with no new load.
    queue.setRepeat(.one)
    await nearEnd()
    let restarted = await wait(30) { playing(ids[2]) && player.state.currentTime < 5 }
    try? await Task.sleep(for: .seconds(3))
    report("repeat-one", restarted && counting.loads == before && playing(ids[2]) && player.state.currentTime < 10)
    if !restarted { print("queue-selftest media: \(await media(player.webView))") }
    queue.setRepeat(.off)

    // The last track ends and the queue stops; YouTube Music must not play anything after it.
    await nearEnd()
    report("last-ended", await wait(30) { player.state.status == .ended && player.state.videoId == ids[2] })
    try? await Task.sleep(for: .seconds(8))
    let page = await PlayerSelfTest.probe(player.webView)
    report(
      "stops-at-end",
      player.state.status == .ended && counting.loads == before && queue.state.index == 2
        && page.contains("\"pageId\":\"\(ids[2])\""), "page \(page)")

    // Previous after the first seconds restarts the track; within them it goes back one.
    await queue.previous()
    report("previous-restarts", await wait(20) { playing(ids[2]) && player.state.currentTime < 5 } && counting.loads == before)
    await queue.previous()
    report("previous-goes-back", await wait(60) { playing(ids[1]) } && queue.state.index == 1 && counting.loads.last == ids[1])

    // Save at a position, restore into a new queue on the same player: it cues paused at that position.
    try? await player.seek(40)
    _ = await wait(5) { abs(player.state.currentTime - 40) < 2 }
    try? await player.pause()
    _ = await wait(5) { player.state.status == .paused }
    queue.save()
    let restored = Queue(player: counting, store: store)
    restored.restore()
    let cued = await wait(60) {
      player.state.status == .paused && player.state.videoId == ids[1] && abs(player.state.currentTime - 40) < 3
    }
    report("restore-paused", cued && restored.state == queue.state && counting.loads.last == "cue:\(ids[1])")
    await restored.play()
    report("restore-plays", await wait(20) { playing(ids[1]) && player.state.currentTime >= 39 })
    try? await player.pause()

    // The hidden UI web view still answers promptly: it fetches radio for autoplay.
    let clock = ContinuousClock()
    let elapsed = await clock.measure {
      _ = try? await ui.callAsyncJavaScript(
        "await new Promise((resolve) => setTimeout(resolve, 10)); return 1", contentWorld: .page)
    }
    report("hidden-ui-round-trip", elapsed < .seconds(2), "\(elapsed)")

    report("volume-held-at-zero", loudest == 0, "loudest \(loudest)")
    print("queue-selftest events: \(events.joined(separator: " "))")
    print("queue-selftest statuses: \(statuses.joined(separator: " "))")
    try? FileManager.default.removeItem(at: store.url)
    print("queue-selftest \(failures == 0 ? "OK" : "FAILED \(failures)")")
    return failures == 0 ? 0 : 1
  }
}
