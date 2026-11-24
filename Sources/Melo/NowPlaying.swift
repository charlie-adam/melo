// Now Playing and media keys. While a track plays, WebKit publishes the rich Control
// Center card from YouTube Music's media session, and our own metadata would race it. Whenever Melo is paused or
// stopped with something queued, the WebKit card can vanish and the Play key would go to Apple Music, so Melo
// publishes a tagged paused claim instead, and only ever clears or replaces info that still carries its tag.
// Commands reach Melo two ways, both routed here: MPRemoteCommandCenter, and the page's media-session handlers, which
// player.js claims so YouTube Music's own queue never sees a key. The claim and command handling follow Kaset (MIT),
// Services/Player/NowPlayingManager.swift.
import AppKit
import MediaPlayer
import OSLog

private let nowPlayingLog = Logger(subsystem: "com.charlieadam.melo", category: "nowplaying")

@MainActor
final class NowPlaying {
  enum Claim: Equatable {
    /// Playing or loading: WebKit's card owns Now Playing.
    case handsOff
    /// Nothing queued: clear our claim if it is still there.
    case release
    case claim(Info)
  }

  struct Info: Equatable {
    var title: String
    var artist: String
    var album: String?
    var duration: Double
    var elapsed: Double
    var artworkUrl: String?
  }

  enum Command: Equatable {
    case play, pause, toggle, next, previous
    case seek(Double)
  }

  /// WebKit may hand one key press both to the page's media session and to the command center, so a second command
  /// of the same kind within this window counts as the same press.
  struct Debounce {
    static let window = Duration.milliseconds(300)
    private var last: [String: ContinuousClock.Instant] = [:]

    mutating func admit(_ command: Command, at now: ContinuousClock.Instant) -> Bool {
      let key: String
      switch command {
      case .play, .pause, .toggle: key = "transport"
      case .next: key = "next"
      case .previous: key = "previous"
      case .seek: return true
      }
      if let previous = last[key], now - previous < Self.window { return false }
      last[key] = now
      return true
    }
  }

  static let serviceIdentifier = "com.charlieadam.melo.now-playing-claim"
  /// YouTube's image hosts; artwork is fetched only from these.
  static let artworkHosts = ["googleusercontent.com", "ytimg.com", "ggpht.com"]

  let queue: Queue
  let player: Player
  private var lastClaim: Claim?
  private var claiming = false
  private var debounce = Debounce()
  private var artwork: (url: String, artwork: MPMediaItemArtwork)?
  private var artworkFetch: String?
  /// The Settings switch. Off, Melo answers no media keys, from the command center or the page.
  private(set) var mediaKeys = true

  init(queue: Queue, player: Player) {
    self.queue = queue
    self.player = player
    // After sleep the system may have dropped the paused claim, so publish it again or Play would go to another app.
    NSWorkspace.shared.notificationCenter.addObserver(
      forName: NSWorkspace.didWakeNotification, object: nil, queue: .main
    ) { [weak self] _ in
      MainActor.assumeIsolated {
        self?.lastClaim = nil
        self?.update()
      }
    }
  }

  // MARK: Claim

  static func claim(for state: PlayerState, item: QueueItem?) -> Claim {
    guard let item else { return .release }
    switch state.status {
    case .playing, .loading:
      return .handsOff
    case .idle, .paused, .ended, .error:
      let page = state.videoId == item.videoId ? state : nil
      return .claim(
        Info(
          title: page?.title ?? item.title,
          artist: page?.artist ?? item.artists.map(\.name).joined(separator: ", "),
          album: page?.album ?? item.album?.name,
          duration: (page?.duration ?? 0) > 0 ? page!.duration : item.durationSec ?? 0,
          elapsed: page?.currentTime ?? 0,
          artworkUrl: item.thumbnailUrl ?? page?.artworkUrl))
    }
  }

  static func isOurs(_ info: [String: Any]?) -> Bool {
    info?[MPNowPlayingInfoPropertyServiceIdentifier] as? String == serviceIdentifier
  }

  /// An https URL on a YouTube image host, asking googleusercontent for a 544px square instead of a thumbnail.
  static func artworkURL(_ raw: String) -> URL? {
    guard var components = URLComponents(string: raw), components.scheme == "https", let host = components.host,
      artworkHosts.contains(where: { host == $0 || host.hasSuffix("." + $0) })
    else { return nil }
    if host.hasSuffix("googleusercontent.com") {
      components.path = components.path.replacing(#/=w\d+-h\d+.*$/#, with: "=w544-h544")
    }
    return components.url
  }

  /// Called on every player and queue change.
  func update() {
    let claim = Self.claim(for: player.state, item: queue.state.current?.item)
    guard claim != lastClaim else { return }
    lastClaim = claim
    apply(claim)
  }

  private func apply(_ claim: Claim) {
    let center = MPNowPlayingInfoCenter.default()
    switch claim {
    case .handsOff:
      guard claiming else { return }
      // Keep the claim until WebKit replaces it, so the keys never fall through to another app in between.
      if Self.isOurs(center.nowPlayingInfo) { center.playbackState = .playing } else { claiming = false }
    case .release:
      guard claiming else { return }
      claiming = false
      guard Self.isOurs(center.nowPlayingInfo) else { return }
      center.nowPlayingInfo = nil
      center.playbackState = .stopped
    case .claim(let info):
      var dictionary: [String: Any] = [
        MPMediaItemPropertyTitle: info.title,
        MPNowPlayingInfoPropertyServiceIdentifier: Self.serviceIdentifier,
        MPNowPlayingInfoPropertyPlaybackRate: 0.0,
        MPNowPlayingInfoPropertyElapsedPlaybackTime: info.elapsed,
        MPMediaItemPropertyPlaybackDuration: info.duration,
        MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
      ]
      if !info.artist.isEmpty { dictionary[MPMediaItemPropertyArtist] = info.artist }
      if let album = info.album { dictionary[MPMediaItemPropertyAlbumTitle] = album }
      if let url = info.artworkUrl {
        if artwork?.url == url { dictionary[MPMediaItemPropertyArtwork] = artwork?.artwork } else { fetchArtwork(url) }
      }
      center.nowPlayingInfo = dictionary
      center.playbackState = .paused
      claiming = true
    }
  }

  private func fetchArtwork(_ raw: String) {
    guard artworkFetch != raw, let url = Self.artworkURL(raw) else { return }
    artworkFetch = raw
    Task { [weak self] in
      guard let (data, _) = try? await URLSession.shared.data(from: url), let image = NSImage(data: data) else { return }
      let artwork = Self.artwork(image)
      guard let self else { return }
      self.artwork = (raw, artwork)
      self.artworkFetch = nil
      if case .claim(let info) = self.lastClaim, info.artworkUrl == raw { self.apply(.claim(info)) }
    }
  }

  /// MediaPlayer calls the request handler off the main thread, so it must not inherit the main actor.
  nonisolated static func artwork(_ image: NSImage) -> MPMediaItemArtwork {
    MPMediaItemArtwork(boundsSize: image.size) { _ in image }
  }

  // MARK: Commands

  func registerCommands() {
    let center = MPRemoteCommandCenter.shared()
    let commands: [(MPRemoteCommand, Command)] = [
      (center.playCommand, .play), (center.pauseCommand, .pause), (center.togglePlayPauseCommand, .toggle),
      (center.nextTrackCommand, .next), (center.previousTrackCommand, .previous),
    ]
    for (remote, command) in commands {
      remote.removeTarget(nil)
      remote.isEnabled = true
      remote.addTarget { [weak self] _ in
        Task { @MainActor in self?.perform(command) }
        return .success
      }
    }
    center.changePlaybackPositionCommand.removeTarget(nil)
    center.changePlaybackPositionCommand.isEnabled = true
    center.changePlaybackPositionCommand.addTarget { [weak self] event in
      guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
      let seconds = event.positionTime
      Task { @MainActor in self?.perform(.seek(seconds)) }
      return .success
    }
    for remote in [center.skipForwardCommand, center.skipBackwardCommand, center.seekForwardCommand, center.seekBackwardCommand] {
      remote.removeTarget(nil)
      remote.isEnabled = false
    }
  }

  func setMediaKeys(_ on: Bool) {
    guard on != mediaKeys else { return }
    mediaKeys = on
    if on { return registerCommands() }
    let center = MPRemoteCommandCenter.shared()
    for remote in [
      center.playCommand, center.pauseCommand, center.togglePlayPauseCommand, center.nextTrackCommand,
      center.previousTrackCommand, center.changePlaybackPositionCommand,
    ] {
      remote.removeTarget(nil)
      remote.isEnabled = false
    }
  }

  /// A media-session action from the page.
  func perform(_ remote: RemoteMessage) {
    guard mediaKeys else { return }
    switch remote.action {
    case .play: perform(.play)
    case .pause: perform(.pause)
    case .nexttrack: perform(.next)
    case .previoustrack: perform(.previous)
    case .seekto: if let seconds = remote.seconds { perform(.seek(seconds)) }
    }
  }

  func perform(_ command: Command) {
    guard debounce.admit(command, at: .now) else { return }
    nowPlayingLog.info("Command \(String(describing: command), privacy: .public)")
    Task {
      switch command {
      case .play: await queue.play()
      case .pause: await queue.pause()
      case .toggle: await queue.toggle()
      case .next: await queue.next()
      case .previous: await queue.previous()
      case .seek(let seconds): try? await player.seek(seconds)
      }
    }
  }
}
