// MELO_PLAYER_SELFTEST=<videoId>[,<videoId>]: plays public tracks anonymously at volume 0 with the window hidden,
// prints one line per check, and quits. It covers router loads, the clock, seek, volume, pause, the end of a track
// (the page must not advance on its own), recovery after the player's or the UI's web content process is killed, the
// stall kill switch, recovery when the network returns, and pausing for sleep.
// AppDelegate refuses to start it unless the player page is hard-muted.
import Foundation
import WebKit

@MainActor
enum PlayerSelfTest {
  static func run(_ player: Player, ui: WKWebView, videoIds: [String]) async -> Int32 {
    var failures = 0
    func report(_ name: String, _ ok: Bool, _ detail: String = "") {
      print("player-selftest \(ok ? "PASS" : "FAIL") \(name): \(detail) [\(describe(player.state))]")
      if !ok { failures += 1 }
    }
    func wait(_ seconds: Double, until condition: () -> Bool) async -> Bool {
      for _ in 0..<Int(seconds * 10) {
        if condition() { return true }
        try? await Task.sleep(for: .milliseconds(100))
      }
      return condition()
    }

    // Record the loudest volume the page reports while playing, and every status, while the test runs.
    var loudest = 0.0
    var statuses: [String] = []
    let sampler = Task {
      while !Task.isCancelled {
        if player.state.status == .playing { loudest = max(loudest, player.state.volume) }
        let entry = "\(player.state.status.rawValue):\(player.state.videoId ?? "-")\(player.state.isAd ? "(ad)" : "")"
        if statuses.last != entry { statuses.append(entry) }
        try? await Task.sleep(for: .milliseconds(50))
      }
    }
    defer { sampler.cancel() }

    let first = videoIds[0]
    let second = videoIds.count > 1 ? videoIds[1] : first
    try? await player.setVolume(0)
    loudest = 0

    player.preloadHome()
    report("home-preload", await wait(30) { player.committed }, "generation \(player.generation)")

    let homeGeneration = player.generation
    await player.load(LoadParams(videoId: first))
    report("load-playing", await wait(60) { player.state.status == .playing && player.state.videoId == first && !player.state.isAd })
    report("router-load", player.generation == homeGeneration, "generation \(homeGeneration) -> \(player.generation)")
    report("metadata", player.state.title != nil && player.state.duration > 0)

    let start = player.state.currentTime
    try? await Task.sleep(for: .seconds(4))
    report("clock-advances", player.state.currentTime - start > 3, "from \(start)")

    try? await player.seek(30)
    report("seek", await wait(3) { abs(player.state.currentTime - 30) < 2 })
    try? await Task.sleep(for: .seconds(5))
    let afterSeek = player.state.currentTime
    report("seek-holds", afterSeek >= 34 && afterSeek < 37, "at \(afterSeek)")

    try? await player.pause()
    try? await Task.sleep(for: .seconds(2))
    let pausedAt = player.state.currentTime
    try? await Task.sleep(for: .seconds(2))
    report("pause", player.state.status == .paused && abs(player.state.currentTime - pausedAt) < 0.3)
    try? await player.play()
    report("play", await wait(10) { player.state.status == .playing })

    try? await player.seek(player.state.duration - 4)
    report("ended", await wait(20) { player.state.status == .ended }, "")
    // Sample the page itself for 10 s: it must never play again. YouTube Music loads its own next track as one ends;
    // the player brings the page back to the ended track, held, within about a second.
    var pages: [String] = []
    for _ in 0..<20 {
      pages.append(await probe(player.webView))
      try? await Task.sleep(for: .milliseconds(500))
    }
    report("no-play-after-end", !pages.contains { $0.contains("\"paused\":false") }, "first \(pages[0])")
    report("back-on-ended-track", pages.last!.contains("\"pageId\":\"\(first)\""), "last \(pages.last!)")

    await player.load(LoadParams(videoId: second))
    report("second-load", await wait(60) { player.state.status == .playing && player.state.videoId == second && !player.state.isAd })
    report("second-router-load", player.generation == homeGeneration, "generation \(player.generation)")

    try? await player.seek(40)
    _ = await wait(3) { abs(player.state.currentTime - 40) < 2 }
    try? await Task.sleep(for: .seconds(1))
    let killedAt = player.state.currentTime
    let killGeneration = player.generation
    // Killing the page's WebContent process stands in for Activity Monitor. WebKit only reports crashes it did not
    // cause itself, so its own private kill call would not exercise recovery; the pid comes from a private key.
    if let pid = player.webView.value(forKey: "_webProcessIdentifier") as? Int32, pid > 0 {
      kill(pid, SIGKILL)
      let resumed = await wait(60) {
        player.generation > killGeneration && player.state.status == .playing && player.state.videoId == second
          && !player.state.isAd && player.state.currentTime >= killedAt - 1
      }
      report("crash-recovery", resumed, "killed at \(killedAt)")
    } else {
      report("crash-recovery", false, "no WebContent pid")
    }

    // The kill switch: pause the media behind player.js's back, as YouTube Music's "still listening?" pause does.
    // Melo still wants it playing, so it must reload at the same position and play.
    let nativePause = "HTMLMediaElement.prototype.pause.call(document.querySelector('video'))"
    _ = await wait(10) { player.state.status == .playing && player.state.currentTime > 5 }
    var stalledAt = player.state.currentTime
    var stallGeneration = player.generation
    _ = try? await player.webView.callAsyncJavaScript(nativePause, contentWorld: .page)
    report("stall-kill-switch", await wait(40) {
      player.generation > stallGeneration && player.state.status == .playing && player.state.videoId == second
        && player.state.currentTime >= stalledAt - 1
    }, "stalled at \(stalledAt)")

    // Offline, the kill switch waits; when the network returns, the track reloads at once.
    _ = await wait(10) { player.state.status == .playing && player.state.currentTime > 5 }
    player.setOnline(false)
    stalledAt = player.state.currentTime
    stallGeneration = player.generation
    _ = try? await player.webView.callAsyncJavaScript(nativePause, contentWorld: .page)
    try? await Task.sleep(for: .seconds(20))
    report("offline-waits", player.generation == stallGeneration, "generation \(player.generation)")
    player.setOnline(true)
    report("online-recovers", await wait(30) {
      player.generation > stallGeneration && player.state.status == .playing && player.state.currentTime >= stalledAt - 1
    }, "stalled at \(stalledAt)")

    // Sleep pauses; after wake Play resumes from the same place.
    _ = await wait(10) { player.state.status == .playing }
    NSWorkspace.shared.notificationCenter.post(name: NSWorkspace.willSleepNotification, object: nil)
    report("sleep-pauses", await wait(5) { player.state.status == .paused && !player.wantsPlay })
    let sleptAt = player.state.currentTime
    NSWorkspace.shared.notificationCenter.post(name: NSWorkspace.didWakeNotification, object: nil)
    try? await Task.sleep(for: .seconds(2))
    report("wake-stays-paused", player.state.status == .paused && abs(player.state.currentTime - sleptAt) < 0.5)
    try? await player.play()
    report("play-after-wake", await wait(10) { player.state.status == .playing && player.state.currentTime >= sleptAt - 0.5 })
    try? await player.pause()

    // The UI keeps its route in its URL, so a reload after its content process dies lands on the same screen.
    let history = #"{"entries":[{"name":"home"},{"name":"album","browseId":"MPREb_selftest"}],"index":1}"#
    _ = try? await ui.callAsyncJavaScript(
      "window.history.replaceState(null, '', '?' + new URLSearchParams({ history: route }))",
      arguments: ["route": history], contentWorld: .page)
    let before = ui.url?.query ?? ""
    if let pid = ui.value(forKey: "_webProcessIdentifier") as? Int32, pid > 0, before.contains("history") {
      kill(pid, SIGKILL)
      var page = ""
      for _ in 0..<100 {
        try? await Task.sleep(for: .milliseconds(200))
        let probe = try? await ui.callAsyncJavaScript(
          "return JSON.stringify({ search: location.search, rendered: document.getElementById('root')?.childElementCount ?? 0 })",
          contentWorld: .page)
        page = probe as? String ?? ""
        if page.contains("MPREb_selftest") && !page.contains("\"rendered\":0") { break }
      }
      let newPid = ui.value(forKey: "_webProcessIdentifier") as? Int32 ?? 0
      report("ui-crash-recovery", newPid != pid && page.contains("MPREb_selftest") && !page.contains("\"rendered\":0"), page)
    } else {
      report("ui-crash-recovery", false, "no UI pid or route in URL (\(before))")
    }

    report("volume-held-at-zero", loudest == 0, "loudest \(loudest)")
    print("player-selftest statuses: \(statuses.joined(separator: " "))")
    print("player-selftest \(failures == 0 ? "OK" : "FAILED \(failures)")")
    return failures == 0 ? 0 : 1
  }

  static func describe(_ state: PlayerState) -> String {
    let time = String(format: "%.1f/%.1f", state.currentTime, state.duration)
    return "\(state.status.rawValue) \(state.videoId ?? "-") \(time) vol \(state.volume) ad \(state.isAd) "
      + "\"\(state.title ?? "")\" by \"\(state.artist ?? "")\" on \"\(state.album ?? "")\" art \(state.artworkUrl != nil)"
      + (state.error.map { " error \($0)" } ?? "")
  }

  /// What the page itself is playing, independent of player.js's own report.
  static func probe(_ webView: WKWebView) async -> String {
    let script = """
      const video = document.querySelector('video');
      const api = document.getElementById('movie_player');
      const data = api && api.getVideoData ? api.getVideoData() : {};
      return JSON.stringify({ pageId: data.video_id || null, paused: video ? video.paused : null,
        time: video ? video.currentTime : null, path: location.pathname + location.search });
      """
    let result = try? await webView.callAsyncJavaScript(script, contentWorld: .page)
    return result as? String ?? "unavailable"
  }
}

extension Player {
  /// Self-tests only: mutes every sound from the player page through WebKit's private page mute, as a backstop to
  /// volume 0, and reports whether the mute took. Unlike the media element's `muted`, it does not pause hidden media.
  func muteForSelfTest() -> Bool {
    let set = Selector(("_setPageMuted:"))
    let get = Selector(("_mediaMutedState"))
    guard webView.responds(to: set), webView.responds(to: get) else { return false }
    typealias Setter = @convention(c) (AnyObject, Selector, UInt) -> Void
    typealias Getter = @convention(c) (AnyObject, Selector) -> UInt
    let audioMuted: UInt = 1
    unsafeBitCast(webView.method(for: set), to: Setter.self)(webView, set, audioMuted)
    return unsafeBitCast(webView.method(for: get), to: Getter.self)(webView, get) & audioMuted != 0
  }
}
