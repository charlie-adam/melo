// The single hidden player: a 1x1 WKWebView running music.youtube.com on the signed-in default data store, so
// Premium applies. Resources/player.js reports state and runs commands inside the page; this type loads tracks,
// drops messages from stale documents and recovers when the web content process dies.
// Melo owns the queue: the page never advances on its own, and `load` is the only way to change track.
import AppKit
import Foundation
import Network
import OSLog
import WebKit

private let playerLog = Logger(subsystem: "com.charlieadam.melo", category: "player")

/// What player.js posts: the state, tagged with the document generation it came from, and whether the page itself is
/// signed in (nil until it says).
struct PlayerMessage: Decodable, Equatable {
  let generation: Int
  var loggedIn: Bool?
  let state: PlayerState
}

/// A media-session action from the page: player.js claims the page's media-session handlers, so the media keys WebKit
/// routes to the page come here instead of to YouTube Music's own queue.
struct RemoteMessage: Decodable, Equatable {
  enum Action: String, Decodable { case play, pause, nexttrack, previoustrack, seekto }
  let generation: Int
  let action: Action
  var seconds: Double?
}

/// A call into `window.__meloPlayer`. Values travel as `callAsyncJavaScript` arguments, never inside the source.
enum PlayerCommand {
  case play, pause, toggle
  case seek(Double)
  case setVolume(Double)
  case navigate(LoadParams)

  static let script = """
    const player = window.__meloPlayer;
    if (!player || player.generation !== generation) return null;
    return player[name](argument ?? undefined);
    """

  var name: String {
    switch self {
    case .play: "play"
    case .pause: "pause"
    case .toggle: "toggle"
    case .seek: "seek"
    case .setVolume: "setVolume"
    case .navigate: "navigate"
    }
  }

  func arguments(generation: Int) -> [String: Any] {
    let argument: Any =
      switch self {
      case .play, .pause, .toggle: NSNull()
      case .seek(let seconds): seconds
      case .setVolume(let volume): volume
      case .navigate(let params): params.watchEndpoint
      }
    return ["generation": generation, "name": name, "argument": argument]
  }
}

extension LoadParams {
  /// The `watchEndpoint` YouTube Music's router takes.
  var watchEndpoint: [String: Any] {
    var endpoint: [String: Any] = ["videoId": videoId]
    if let playlistId { endpoint["playlistId"] = playlistId }
    if let index { endpoint["index"] = index }
    return endpoint
  }
}

/// The kill switch: the player counts as stuck when Melo wants it playing, it is online and showing no ad, and its
/// clock has not moved for `limit`. A stuck player is reloaded at the same position, at most `attempts` times in a row
/// for one track; after that the track counts as failed.
struct StallWatch {
  enum Verdict: Equatable { case fine, reload, fail }
  static let limit = Duration.seconds(15)
  static let attempts = 2

  private var mark: (key: String, time: Double, since: ContinuousClock.Instant)?
  private var reloads: (videoId: String, count: Int)?

  mutating func check(
    _ state: PlayerState, generation: Int, wantsPlay: Bool, online: Bool, now: ContinuousClock.Instant
  ) -> Verdict {
    guard wantsPlay, online, !state.isAd, let videoId = state.videoId, state.status != .ended, state.status != .error
    else {
      mark = nil
      return .fine
    }
    let key = "\(generation):\(videoId)"
    guard let mark, mark.key == key, abs(state.currentTime - mark.time) < 0.1 else {
      // The clock moved: the track is healthy again, so later stalls get fresh attempts.
      if let mark, mark.key == key, state.status == .playing { reloads = nil }
      self.mark = (key, state.currentTime, now)
      return .fine
    }
    guard now - mark.since >= Self.limit else { return .fine }
    self.mark = nil
    let count = reloads?.videoId == videoId ? reloads!.count : 0
    guard count < Self.attempts else {
      reloads = nil
      return .fail
    }
    reloads = (videoId, count + 1)
    return .reload
  }
}

@MainActor
final class Player: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
  /// The app's player, set once at launch.
  static var shared: Player?
  static let handlerName = "meloPlayer"
  static let remoteHandlerName = "meloRemote"
  static let origin = URL(string: "https://music.youtube.com/")!
  /// Hosts the player document may navigate to: YouTube Music and the sign-in and consent redirects. The list follows
  /// Kaset (MIT).
  nonisolated static let allowedHosts: Set<String> = [
    "music.youtube.com", "accounts.google.com", "consent.google.com", "consent.youtube.com",
  ]

  /// Main-frame navigations stay on https and the trusted hosts; subframes are YouTube Music's own business.
  nonisolated static func allowsNavigation(to url: URL?, isMainFrame: Bool) -> Bool {
    guard isMainFrame else { return true }
    guard let url, url.scheme == "https", let host = url.host else { return false }
    return allowedHosts.contains(host)
  }
  static let confirmationTimeout = Duration.seconds(10)

  let webView: WKWebView
  var onState: ((PlayerState) -> Void)?
  var onRemote: ((RemoteMessage) -> Void)?
  private(set) var state = PlayerState.idle
  /// Incremented on every full load; messages from any other document are dropped.
  private(set) var generation = 0
  private(set) var committed = false
  private var target: LoadParams?
  private var volume = 1.0
  private var confirmation: Task<Void, Never>?
  /// Whether the current document is signed in, as the page reports it.
  private var pageLoggedIn: Bool?
  /// The app's sign-in a reload was last made for, so a page that stays signed out cannot cause a reload loop.
  private var reloadedFor: Bool?
  /// Whether Melo wants sound: set by load and play, cleared by cue, pause, sleep and the end of a track. The page's
  /// own status cannot say this, because a stalled or self-paused page looks the same as a paused one.
  private(set) var wantsPlay = false
  /// Where the current track last played, for reloads; the page reports 0 while it is loading or failed.
  private var position: (videoId: String, seconds: Double)?
  private var stall = StallWatch()
  private(set) var online = true
  private let pathMonitor = NWPathMonitor()
  private var watchdog: Task<Void, Never>?

  /// The app's sign-in. A page loaded before sign-in (the launch preload, say) stays signed out and serves ads even to
  /// Premium, so a page whose sign-in differs from this one is reloaded.
  var signedIn: Bool? {
    didSet {
      if signedIn != oldValue { reloadedFor = nil }
      reconcileAccount()
    }
  }

  init(dataStore: WKWebsiteDataStore = .default()) {
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = dataStore
    configuration.mediaTypesRequiringUserActionForPlayback = []
    configuration.allowsAirPlayForMediaPlayback = true
    webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 1, height: 1), configuration: configuration)
    webView.customUserAgent = Auth.webViewUserAgent
    webView.alphaValue = 0
    webView.isInspectable = true
    super.init()
    webView.navigationDelegate = self
    configuration.userContentController.add(self, contentWorld: .page, name: Self.handlerName)
    configuration.userContentController.add(self, contentWorld: .page, name: Self.remoteHandlerName)
    watchOnline()
    watchSleep()
    // A stuck page sends nothing, so the kill switch runs on its own clock rather than on page messages.
    watchdog = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(2))
        self?.checkStall()
      }
    }
  }

  // MARK: Commands

  /// Loads YouTube Music's home with autoplay blocked, so the first track can go through the in-page router.
  func preloadHome() {
    fullLoad(Self.homeURL(generation:), autoplay: false, resumeAt: 0)
  }

  /// Plays a track: through the router when a document is ready, otherwise (or when the router does not confirm the
  /// new media in time) with a full load of `watch?v=`.
  func load(_ params: LoadParams) async {
    target = params
    wantsPlay = true
    confirmation?.cancel()
    guard committed, (try? await run(.navigate(params))) as? Bool == true else {
      playerLog.info("Full load for \(params.videoId, privacy: .public)")
      fullLoad(params, autoplay: true, resumeAt: 0)
      return
    }
    let started = generation
    confirmation = Task { [weak self] in
      try? await Task.sleep(for: Self.confirmationTimeout)
      while let self, !Task.isCancelled, self.state.isAd { try? await Task.sleep(for: .seconds(1)) }
      guard let self, !Task.isCancelled, self.generation == started, self.target == params else { return }
      playerLog.warning("Router did not confirm \(params.videoId, privacy: .public); full load")
      self.fullLoad(params, autoplay: true, resumeAt: 0)
    }
  }

  /// Loads a track paused at `seconds`, for restoring the queue at launch. Play starts it.
  func cue(_ params: LoadParams, at seconds: Double) {
    target = params
    wantsPlay = false
    fullLoad(params, autoplay: false, resumeAt: max(0, seconds))
  }

  func play() async throws {
    wantsPlay = true
    try await run(.play)
  }

  func pause() async throws {
    wantsPlay = false
    try await run(.pause)
  }

  func toggle() async throws {
    wantsPlay = ![.playing, .loading].contains(state.status)
    try await run(.toggle)
  }
  func seek(_ seconds: Double) async throws {
    // A stall reload resumes here, not where the track last played (Previous after an end would resume at the end).
    if let videoId = target?.videoId { position = (videoId, max(0, seconds)) }
    try await run(.seek(max(0, seconds)))
  }

  func setVolume(_ volume: Double) async throws {
    self.volume = min(max(volume, 0), 1)
    try await run(.setVolume(self.volume))
  }

  @discardableResult
  private func run(_ command: PlayerCommand) async throws -> Any? {
    try await webView.callAsyncJavaScript(
      PlayerCommand.script, arguments: command.arguments(generation: generation), contentWorld: .page)
  }

  // MARK: Documents

  static func homeURL(generation: Int) -> URL {
    url(path: "/", query: [], generation: generation)
  }

  static func watchURL(_ params: LoadParams, generation: Int) -> URL {
    var query = [URLQueryItem(name: "v", value: params.videoId)]
    if let playlistId = params.playlistId { query.append(URLQueryItem(name: "list", value: playlistId)) }
    if let index = params.index { query.append(URLQueryItem(name: "index", value: String(index))) }
    return url(path: "/watch", query: query, generation: generation)
  }

  /// The generation rides in the query and the fragment, so it survives redirects that drop either.
  private static func url(path: String, query: [URLQueryItem], generation: Int) -> URL {
    var components = URLComponents(url: origin, resolvingAgainstBaseURL: false)!
    components.path = path
    components.queryItems = query + [URLQueryItem(name: "meloGeneration", value: String(generation))]
    components.fragment = "meloGeneration=\(generation)"
    return components.url!
  }

  /// player-core.js and player.js in one scope, called with this document's starting values.
  static func userScript(volume: Double, autoplay: Bool, resumeAt: Double) -> String {
    struct Boot: Encodable { let volume: Double, autoplay: Bool, resumeAt: Double }
    let encoder = JSONEncoder()
    encoder.outputFormatting = .sortedKeys
    let boot = String(decoding: try! encoder.encode(Boot(volume: volume, autoplay: autoplay, resumeAt: resumeAt)), as: UTF8.self)
    return "(function (boot) {\n'use strict';\n\(scriptSource)\n})(\(boot));"
  }

  static let scriptSource: String = ["player-core", "player"].map { name in
    let url = Bundle.module.url(forResource: name, withExtension: "js", subdirectory: "Resources")!
    return try! String(contentsOf: url, encoding: .utf8)
  }.joined(separator: "\n")

  private func fullLoad(_ params: LoadParams, autoplay: Bool, resumeAt: Double) {
    fullLoad({ Self.watchURL(params, generation: $0) }, autoplay: autoplay, resumeAt: resumeAt)
    // The new document reports nothing until it loads, so say what is happening instead of repeating the old state.
    state = PlayerState(status: .loading, videoId: params.videoId, currentTime: 0, duration: 0, volume: volume, isAd: false)
    onState?(state)
  }

  private func fullLoad(_ makeURL: (Int) -> URL, autoplay: Bool, resumeAt: Double) {
    confirmation?.cancel()
    let replace = committed
    generation += 1
    committed = false
    let url = makeURL(generation)
    let controller = webView.configuration.userContentController
    pageLoggedIn = nil
    controller.removeAllUserScripts()
    controller.addUserScript(
      WKUserScript(
        source: Self.userScript(volume: volume, autoplay: autoplay, resumeAt: resumeAt),
        injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page))
    // Replacing the location keeps the back-forward list from growing, which held WebContent memory down in Kaset.
    if replace {
      webView.callAsyncJavaScript(
        "location.replace(url)", arguments: ["url": url.absoluteString], in: nil, in: .page, completionHandler: nil)
    } else {
      webView.load(URLRequest(url: url))
    }
  }

  // MARK: WebKit

  /// The page is untrusted: only a well-formed message from YouTube Music's main frame gets through.
  static func decode<Message: Decodable>(
    _ body: Any, isMainFrame: Bool, scheme: String, host: String, as type: Message.Type = PlayerMessage.self
  ) -> Message? {
    guard isMainFrame, scheme == "https", host == "music.youtube.com",
      JSONSerialization.isValidJSONObject(body),
      let data = try? JSONSerialization.data(withJSONObject: body)
    else { return nil }
    return try? JSONDecoder().decode(Message.self, from: data)
  }

  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    let origin = message.frameInfo.securityOrigin
    playerLog.debug("\(message.name, privacy: .public) message, \(Self.size(of: message.body)) bytes")
    if message.name == Self.remoteHandlerName {
      let remote = Self.decode(
        message.body, isMainFrame: message.frameInfo.isMainFrame, scheme: origin.protocol, host: origin.host,
        as: RemoteMessage.self)
      guard let remote, remote.generation == generation else { return }
      playerLog.info("Media session \(remote.action.rawValue, privacy: .public)")
      onRemote?(remote)
      return
    }
    guard
      let message = Self.decode(
        message.body, isMainFrame: message.frameInfo.isMainFrame, scheme: origin.protocol, host: origin.host)
    else {
      playerLog.error("Dropped a malformed or foreign player message")
      return
    }
    guard message.generation == generation else { return }
    if let loggedIn = message.loggedIn, loggedIn != pageLoggedIn {
      pageLoggedIn = loggedIn
      reconcileAccount()
      guard message.generation == generation else { return }
    }
    let previous = state
    state = message.state
    // Offline, a failed page is waiting for the network, not an unplayable track; going online reloads it.
    if !online, state.status == .error {
      state.status = .loading
      state.error = nil
    }
    if state.status == .ended { wantsPlay = false }
    if let videoId = state.videoId, videoId == target?.videoId, [.playing, .paused].contains(state.status),
      state.currentTime > 0
    {
      position = (videoId, state.currentTime)
    }
    if let target, state.videoId == target.videoId, state.duration > 0,
      [.playing, .paused, .ended].contains(state.status)
    {
      confirmation?.cancel()
    }
    if state.status != previous.status || state.videoId != previous.videoId {
      playerLog.info(
        "\(self.state.status.rawValue, privacy: .public) \(self.state.videoId ?? "-", privacy: .public) at \(self.state.currentTime, privacy: .public)s"
      )
    }
    onState?(state)
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    committed = true
  }

  func webView(
    _ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
    decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void
  ) {
    let url = action.request.url
    let allowed = Self.allowsNavigation(to: url, isMainFrame: action.targetFrame?.isMainFrame == true)
    if !allowed { playerLog.warning("Blocked player navigation to \(url?.host ?? "-", privacy: .public)") }
    decisionHandler(allowed ? .allow : .cancel)
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    playerLog.error("Player content process terminated; recovering")
    committed = false
    stall = StallWatch()
    reload()
  }

  /// Reloads the same track at the same position, playing only if Melo wants it playing, or the home page with no
  /// track.
  private func reload() {
    guard let target else { return preloadHome() }
    let resumeAt = position?.videoId == target.videoId ? position!.seconds : 0
    fullLoad(target, autoplay: wantsPlay, resumeAt: resumeAt)
  }

  // MARK: Resilience

  /// The kill switch, every 2 s: reloads a stuck track at its position, and fails it after repeated stalls so the
  /// queue moves on.
  private func checkStall() {
    switch stall.check(state, generation: generation, wantsPlay: wantsPlay, online: online, now: .now) {
    case .fine: return
    case .reload:
      playerLog.warning("No progress for \(StallWatch.limit) while playing; reloading the track")
      reload()
    case .fail:
      playerLog.error("Track stalled after \(StallWatch.attempts) reloads; reporting it as failed")
      state.status = .error
      state.error = "Playback stalled"
      onState?(state)
    }
  }

  private func watchOnline() {
    pathMonitor.pathUpdateHandler = { [weak self] path in
      let online = path.status == .satisfied
      Task { @MainActor in self?.setOnline(online) }
    }
    pathMonitor.start(queue: .main)
  }

  /// Network loss leaves the page waiting or failed. When the network returns, a track Melo wants playing reloads at
  /// its position unless it is already playing again; the kill switch covers one that only looks like it is.
  func setOnline(_ online: Bool) {
    guard online != self.online else { return }
    self.online = online
    playerLog.info("Network \(online ? "back" : "lost", privacy: .public)")
    guard online, wantsPlay, target != nil, state.status != .playing else { return }
    reload()
  }

  /// Pauses before the Mac sleeps, as Music does, so the state after wake is a true pause that Play resumes. A track
  /// that no longer plays after a long pause is caught by the kill switch once Play asks for it.
  private func watchSleep() {
    let center = NSWorkspace.shared.notificationCenter
    center.addObserver(forName: NSWorkspace.willSleepNotification, object: nil, queue: .main) { [weak self] _ in
      MainActor.assumeIsolated {
        guard let self, self.wantsPlay else { return }
        playerLog.info("Pausing for sleep")
        Task { try? await self.pause() }
      }
    }
  }

  /// A message body's JSON size, for logs that must not show the values.
  nonisolated static func size(of body: Any) -> Int {
    guard JSONSerialization.isValidJSONObject(body), let data = try? JSONSerialization.data(withJSONObject: body)
    else { return 0 }
    return data.count
  }

  /// Reload when the page's sign-in, once known, differs from the app's, at most once per app sign-in value.
  static func needsReload(signedIn: Bool?, pageLoggedIn: Bool?, reloadedFor: Bool?) -> Bool {
    guard let signedIn, let pageLoggedIn else { return false }
    return pageLoggedIn != signedIn && reloadedFor != signedIn
  }

  private func reconcileAccount() {
    guard Self.needsReload(signedIn: signedIn, pageLoggedIn: pageLoggedIn, reloadedFor: reloadedFor),
      let signedIn, let pageLoggedIn
    else { return }
    reloadedFor = signedIn
    playerLog.info("Player page signedIn=\(pageLoggedIn) but the app's is \(signedIn); reloading the page")
    reload()
  }
}
