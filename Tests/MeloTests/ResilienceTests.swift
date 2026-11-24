import Foundation
import Testing

@testable import Melo

@Suite struct StallWatchTests {
  let start = ContinuousClock.now

  func state(_ status: PlayerState.Status, at time: Double, videoId: String? = "7qQg6YbSMko", isAd: Bool = false)
    -> PlayerState
  {
    PlayerState(status: status, videoId: videoId, currentTime: time, duration: 200, volume: 0, isAd: isAd)
  }

  @Test func reloadsAfterTheLimitWithoutProgress() {
    var watch = StallWatch()
    let stuck = state(.playing, at: 40)
    #expect(watch.check(stuck, generation: 1, wantsPlay: true, online: true, now: start) == .fine)
    #expect(watch.check(stuck, generation: 1, wantsPlay: true, online: true, now: start + .seconds(14)) == .fine)
    #expect(watch.check(stuck, generation: 1, wantsPlay: true, online: true, now: start + .seconds(15)) == .reload)
  }

  @Test func progressResetsTheClock() {
    var watch = StallWatch()
    _ = watch.check(state(.playing, at: 40), generation: 1, wantsPlay: true, online: true, now: start)
    _ = watch.check(state(.playing, at: 50), generation: 1, wantsPlay: true, online: true, now: start + .seconds(10))
    #expect(
      watch.check(state(.playing, at: 50), generation: 1, wantsPlay: true, online: true, now: start + .seconds(20))
        == .fine)
  }

  @Test(arguments: [
    (false, true, false, PlayerState.Status.playing),  // Melo paused it
    (true, false, false, .playing),  // offline: going online handles it
    (true, true, true, .playing),  // an ad
    (true, true, false, .ended),
    (true, true, false, .error),  // the queue handles failures
  ])
  func leavesAlone(wantsPlay: Bool, online: Bool, isAd: Bool, status: PlayerState.Status) {
    var watch = StallWatch()
    let stuck = state(status, at: 40, isAd: isAd)
    for second in [0, 20, 40, 60] {
      #expect(
        watch.check(stuck, generation: 1, wantsPlay: wantsPlay, online: online, now: start + .seconds(second)) == .fine)
    }
  }

  @Test func catchesAPausedOrLoadingPageThatShouldPlay() {
    for status in [PlayerState.Status.paused, .loading] {
      var watch = StallWatch()
      _ = watch.check(state(status, at: 0), generation: 1, wantsPlay: true, online: true, now: start)
      #expect(
        watch.check(state(status, at: 0), generation: 1, wantsPlay: true, online: true, now: start + .seconds(15))
          == .reload)
    }
  }

  @Test func failsAfterRepeatedStallsOfOneTrack() {
    var watch = StallWatch()
    var now = start
    var verdicts: [StallWatch.Verdict] = []
    // Each reload is a new document generation that never makes progress.
    for generation in 1...3 {
      _ = watch.check(state(.loading, at: 0), generation: generation, wantsPlay: true, online: true, now: now)
      now += .seconds(15)
      verdicts.append(watch.check(state(.loading, at: 0), generation: generation, wantsPlay: true, online: true, now: now))
    }
    #expect(verdicts == [.reload, .reload, .fail])
  }

  @Test func playingAgainGivesFreshAttempts() {
    var watch = StallWatch()
    var now = start
    for generation in 1...4 {
      _ = watch.check(state(.playing, at: 10), generation: generation, wantsPlay: true, online: true, now: now)
      now += .seconds(15)
      #expect(watch.check(state(.playing, at: 10), generation: generation, wantsPlay: true, online: true, now: now) == .reload)
      // The reloaded document plays for a while before the next stall.
      _ = watch.check(state(.playing, at: 10), generation: generation + 100, wantsPlay: true, online: true, now: now)
      _ = watch.check(state(.playing, at: 12), generation: generation + 100, wantsPlay: true, online: true, now: now)
    }
  }
}

@Suite struct TrustedHostTests {
  @Test(arguments: [
    "https://music.youtube.com/watch?v=x", "https://accounts.google.com/ServiceLogin", "https://consent.youtube.com/m",
    "https://consent.google.com/ml",
  ])
  func playerAllows(url: String) {
    #expect(Player.allowsNavigation(to: URL(string: url), isMainFrame: true))
  }

  @Test(arguments: [
    "http://music.youtube.com/", "https://www.youtube.com/watch?v=x", "https://evil.example/",
    "https://music.youtube.com.evil.example/", "javascript:alert(1)", "about:blank",
  ])
  func playerBlocks(url: String) {
    #expect(!Player.allowsNavigation(to: URL(string: url), isMainFrame: true))
  }

  @Test func playerLeavesSubframesAlone() {
    #expect(Player.allowsNavigation(to: URL(string: "https://www.google.com/recaptcha"), isMainFrame: false))
  }

  @Test(arguments: [
    ("https://accounts.google.com/v3/signin", Auth.LoginNavigation.allow),
    ("https://accounts.youtube.com/accounts/SetSID", .allow),
    ("https://www.youtube.com/signin?action_handle_signin=true", .allow),
    ("https://music.youtube.com/", .allow),
    ("https://google.com/", .allow),
    ("http://accounts.google.com/", .browser),
    ("https://support.example.com/help", .browser),
    ("https://accounts.google.com.evil.example/", .browser),
    ("https://evilgoogle.com/", .browser),
    ("file:///etc/passwd", .block),
    ("javascript:alert(1)", .block),
  ])
  func loginWindow(url: String, expected: Auth.LoginNavigation) {
    #expect(Auth.loginNavigation(to: URL(string: url), isMainFrame: true) == expected)
  }
}

@Suite struct RetryPolicyTests {
  @Test(arguments: ["browse", "search", "music/get_search_suggestions", "next", "account/account_menu"])
  func retriesReadsOnNetworkAndServerErrors(endpoint: String) {
    #expect(InnerTube.shouldRetry(endpoint, after: APIError(kind: .network)))
    #expect(InnerTube.shouldRetry(endpoint, after: APIError(kind: .http, status: 503)))
    #expect(InnerTube.shouldRetry(endpoint, after: APIError(kind: .http, status: 429)))
    #expect(!InnerTube.shouldRetry(endpoint, after: APIError(kind: .http, status: 404)))
    #expect(!InnerTube.shouldRetry(endpoint, after: APIError(kind: .auth, status: 401)))
    #expect(!InnerTube.shouldRetry(endpoint, after: APIError(kind: .parse, status: 200)))
  }

  @Test func neverRetriesMutations() {
    for endpoint in InnerTube.endpoints.subtracting(InnerTube.reads) {
      #expect(!InnerTube.shouldRetry(endpoint, after: APIError(kind: .network)), "\(endpoint)")
      #expect(!InnerTube.shouldRetry(endpoint, after: APIError(kind: .http, status: 503)), "\(endpoint)")
    }
  }

  @Test func everyReadIsAllowlisted() {
    #expect(InnerTube.reads.isSubset(of: InnerTube.endpoints))
  }
}

/// Answers InnerTube requests from a script: the page with the API key, then one scripted outcome per API call.
final class ScriptedProtocol: URLProtocol, @unchecked Sendable {
  enum Outcome { case fail, status(Int) }
  nonisolated(unsafe) static var outcomes: [Outcome] = []
  nonisolated(unsafe) static var apiCalls: [String] = []
  static let lock = NSLock()

  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

  override func startLoading() {
    let url = request.url!
    var outcome = Outcome.status(200)
    var body = Data(#"{"responseContext":{}}"#.utf8)
    if url.path.hasPrefix("/youtubei/") {
      Self.lock.withLock {
        Self.apiCalls.append(url.path)
        if !Self.outcomes.isEmpty { outcome = Self.outcomes.removeFirst() }
      }
    } else {
      body = Data(#"ytcfg.set({"INNERTUBE_API_KEY":"test-key"})"#.utf8)
    }
    switch outcome {
    case .fail:
      client?.urlProtocol(self, didFailWithError: URLError(.networkConnectionLost))
    case .status(let status):
      let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: nil)!
      client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
      client?.urlProtocol(self, didLoad: body)
      client?.urlProtocolDidFinishLoading(self)
    }
  }

  override func stopLoading() {}
}

@MainActor @Suite(.serialized) struct RetryTests {
  func client(_ outcomes: [ScriptedProtocol.Outcome]) -> InnerTubeClient {
    ScriptedProtocol.outcomes = outcomes
    ScriptedProtocol.apiCalls = []
    let configuration = InnerTubeClient.configuration()
    configuration.protocolClasses = [ScriptedProtocol.self]
    return InnerTubeClient(session: URLSession(configuration: configuration))
  }

  @Test func readRetriesOnceAfterANetworkError() async throws {
    let json = try await client([.fail, .status(200)]).call("browse", body: ["browseId": "FEmusic_home"], signedOut: true)
    #expect(json is [String: Any])
    #expect(ScriptedProtocol.apiCalls == ["/youtubei/v1/browse", "/youtubei/v1/browse"])
  }

  @Test func readGivesUpAfterTheRetry() async {
    await #expect(throws: APIError(kind: .http, status: 503)) {
      try await client([.status(503), .status(503), .status(200)]).call("search", body: [:], signedOut: true)
    }
    #expect(ScriptedProtocol.apiCalls.count == 2)
  }

  @Test func mutationIsNeverRetried() async {
    await #expect(throws: APIError(kind: .network)) {
      try await client([.fail, .status(200)]).call("like/like", body: [:], signedOut: true)
    }
    #expect(ScriptedProtocol.apiCalls == ["/youtubei/v1/like/like"])
  }

  @Test func timesOutSensibly() {
    let configuration = InnerTubeClient.configuration()
    #expect(configuration.timeoutIntervalForRequest == 10)
    #expect(configuration.timeoutIntervalForResource == 30)
  }
}

@Suite struct BridgeGuardTests {
  func decode(_ body: Any) throws -> Request {
    try JSONDecoder().decode(Request.self, from: JSONSerialization.data(withJSONObject: body))
  }

  @Test func decodesPlayerGet() throws {
    #expect(try decode(["method": "player.get", "params": [:]]) == .playerGet)
  }

  @Test func satellitesGetOnlyWhatTheyNeed() throws {
    let allowed: [[String: Any]] = [
      ["method": "queue.get", "params": [:]], ["method": "queue.next", "params": [:]],
      ["method": "player.toggle", "params": [:]], ["method": "player.get", "params": [:]],
      ["method": "app.showWindow", "params": [:]], ["method": "settings.set", "params": ["miniPlayer": false]],
      ["method": "api.call", "params": ["endpoint": "next", "body": ["videoId": "7qQg6YbSMko"]]],
      ["method": "api.call", "params": ["endpoint": "like/like", "body": [:]]],
    ]
    let refused: [[String: Any]] = [
      ["method": "auth.signOut", "params": [:]], ["method": "auth.signIn", "params": [:]],
      ["method": "queue.set", "params": ["items": [], "index": 0]], ["method": "player.load", "params": ["videoId": "x"]],
      ["method": "api.call", "params": ["endpoint": "playlist/create", "body": [:]]],
      ["method": "api.call", "params": ["endpoint": "browse/edit_playlist", "body": [:]]],
      ["method": "api.call", "params": ["endpoint": "browse", "body": [:]]],
      ["method": "lyrics.lrclib", "params": ["title": "t", "artist": "a", "durationSec": 1]],
    ]
    for body in allowed { #expect(Bridge.satelliteMay(try decode(body)), "\(body)") }
    for body in refused { #expect(!Bridge.satelliteMay(try decode(body)), "\(body)") }
  }

  @MainActor @Test func satelliteRequestsOutsideTheListAreRejected() async {
    await #expect(throws: Bridge.Refused.self) {
      try await Bridge.handle(["method": "auth.signOut", "params": [:]], satellite: true)
    }
  }

  @Test func onlyTheAppMainFrameMayUseTheBridge() {
    let dev = URL(string: "http://127.0.0.1:5173/")
    #expect(Bridge.isAppFrame(URL(string: "melo://app/?history=x#mini"), isMainFrame: true, devURL: nil))
    #expect(!Bridge.isAppFrame(URL(string: "melo://app/"), isMainFrame: false, devURL: nil))
    #expect(!Bridge.isAppFrame(URL(string: "https://music.youtube.com/"), isMainFrame: true, devURL: nil))
    #expect(!Bridge.isAppFrame(nil, isMainFrame: true, devURL: nil))
    #expect(Bridge.isAppFrame(URL(string: "http://127.0.0.1:5173/"), isMainFrame: true, devURL: dev))
    #expect(!Bridge.isAppFrame(URL(string: "http://127.0.0.1:5173/"), isMainFrame: true, devURL: nil))
  }

  @Test func logSizesCountBytesNotValues() {
    #expect(Bridge.size(of: ["method": "ping", "params": ["sentAt": 1]]) > 0)
    #expect(Bridge.size(of: "not an object") == 0)
  }
}
