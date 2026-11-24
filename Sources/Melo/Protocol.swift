// The Swift mirror of ui/src/bridge/protocol.ts. Every message between the UI and the shell is declared in both
// files, with the same names and fields, and they change together.
import Foundation

/// A request from the UI, posted as `{ method, params }`.
enum Request: Decodable, Equatable {
  case ping(PingParams)
  // Sign-in and InnerTube.
  case authStatus, authSignIn, authSignOut
  case apiCall(APICallParams)
  // Player: the hidden YouTube Music player.
  case playerPlay, playerPause, playerToggle
  case playerSeek(SeekParams)
  case playerSetVolume(VolumeParams)
  case playerLoad(LoadParams)
  case playerGet
  // Queue: Melo's own queue, which lives in Swift.
  case queueGet
  case queueSet(QueueSetParams)
  case queuePlayNext(QueueItemParams), queueAdd(QueueItemParams)
  case queueRemove(QueueIndexParams), queueJump(QueueIndexParams)
  case queueMove(QueueMoveParams)
  case queueNext, queuePrevious
  case queueSetShuffle(QueueFlagParams), queueSetAutoplay(QueueFlagParams)
  case queueSetRepeat(QueueRepeatParams)
  case queueAppend(QueueAppendParams)
  // Settings, lyrics, and the menu bar and mini player pages.
  case settingsGet
  case settingsSet(SettingsPatch)
  case lyricsLrclib(LrclibParams)
  case appShowWindow, appQuit
  case libraryBroadcast(LibraryChange)
  case navState(NavState)
  case appCopyLink(CopyLinkParams)

  private enum Keys: String, CodingKey { case method, params }

  init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: Keys.self)
    let method = try container.decode(String.self, forKey: .method)
    switch method {
    case "ping": self = .ping(try container.decode(PingParams.self, forKey: .params))
    // Sign-in and InnerTube.
    case "auth.status": self = .authStatus
    case "auth.signIn": self = .authSignIn
    case "auth.signOut": self = .authSignOut
    case "api.call": self = .apiCall(try container.decode(APICallParams.self, forKey: .params))
    // Player
    case "player.play": self = .playerPlay
    case "player.pause": self = .playerPause
    case "player.toggle": self = .playerToggle
    case "player.seek": self = .playerSeek(try container.decode(SeekParams.self, forKey: .params))
    case "player.setVolume": self = .playerSetVolume(try container.decode(VolumeParams.self, forKey: .params))
    case "player.load": self = .playerLoad(try container.decode(LoadParams.self, forKey: .params))
    case "player.get": self = .playerGet
    // Queue
    case "queue.get": self = .queueGet
    case "queue.set": self = .queueSet(try container.decode(QueueSetParams.self, forKey: .params))
    case "queue.playNext": self = .queuePlayNext(try container.decode(QueueItemParams.self, forKey: .params))
    case "queue.add": self = .queueAdd(try container.decode(QueueItemParams.self, forKey: .params))
    case "queue.remove": self = .queueRemove(try container.decode(QueueIndexParams.self, forKey: .params))
    case "queue.jump": self = .queueJump(try container.decode(QueueIndexParams.self, forKey: .params))
    case "queue.move": self = .queueMove(try container.decode(QueueMoveParams.self, forKey: .params))
    case "queue.next": self = .queueNext
    case "queue.previous": self = .queuePrevious
    case "queue.setShuffle": self = .queueSetShuffle(try container.decode(QueueFlagParams.self, forKey: .params))
    case "queue.setAutoplay": self = .queueSetAutoplay(try container.decode(QueueFlagParams.self, forKey: .params))
    case "queue.setRepeat": self = .queueSetRepeat(try container.decode(QueueRepeatParams.self, forKey: .params))
    case "queue.append": self = .queueAppend(try container.decode(QueueAppendParams.self, forKey: .params))
    case "settings.get": self = .settingsGet
    case "settings.set": self = .settingsSet(try container.decode(SettingsPatch.self, forKey: .params))
    case "lyrics.lrclib": self = .lyricsLrclib(try container.decode(LrclibParams.self, forKey: .params))
    case "app.showWindow": self = .appShowWindow
    case "app.quit": self = .appQuit
    case "library.broadcast": self = .libraryBroadcast(try container.decode(LibraryChange.self, forKey: .params))
    case "nav.state": self = .navState(try container.decode(NavState.self, forKey: .params))
    case "app.copyLink": self = .appCopyLink(try container.decode(CopyLinkParams.self, forKey: .params))
    default:
      throw DecodingError.dataCorruptedError(forKey: .method, in: container, debugDescription: "Unknown method \(method)")
    }
  }
}

struct PingParams: Codable, Equatable {
  let sentAt: Double
}

struct PingResult: Codable, Equatable {
  let receivedAt: Double
}

/// An event pushed to the UI, delivered as `{ name, payload }`.
enum Event: Encodable, Equatable {
  case authChanged(AuthStatus)
  case playerState(PlayerState)  // Player
  // Queue
  case queueChanged(QueueSnapshot)
  case queueNeedsMore(NeedsMore)
  case queueUnplayable(Unplayable)
  case settingsChanged(AppSettings)
  case libraryChanged(LibraryChange)
  case navGo(NavGo)

  private enum Keys: String, CodingKey { case name, payload }

  func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: Keys.self)
    switch self {
    case .authChanged(let status):
      try container.encode("auth.changed", forKey: .name)
      try container.encode(status, forKey: .payload)
    // Player
    case .playerState(let state):
      try container.encode("player.state", forKey: .name)
      try container.encode(state, forKey: .payload)
    // Queue
    case .queueChanged(let snapshot):
      try container.encode("queue.changed", forKey: .name)
      try container.encode(snapshot, forKey: .payload)
    case .queueNeedsMore(let request):
      try container.encode("queue.needsMore", forKey: .name)
      try container.encode(request, forKey: .payload)
    case .queueUnplayable(let unplayable):
      try container.encode("queue.unplayable", forKey: .name)
      try container.encode(unplayable, forKey: .payload)
    case .settingsChanged(let settings):
      try container.encode("settings.changed", forKey: .name)
      try container.encode(settings, forKey: .payload)
    case .libraryChanged(let change):
      try container.encode("library.changed", forKey: .name)
      try container.encode(change, forKey: .payload)
    case .navGo(let go):
      try container.encode("nav.go", forKey: .name)
      try container.encode(go, forKey: .payload)
    }
  }
}

// Sign-in and InnerTube.

/// The result of `auth.status`, `auth.signIn` and `auth.signOut`, and the `auth.changed` payload.
/// `expired` means a signed-in call was refused with 401 or 403 and the UI should offer to sign in again.
struct AuthStatus: Codable, Equatable {
  let signedIn: Bool
  let expired: Bool
}

/// `api.call` resolves with `{ ok: true, json }`, the raw InnerTube response, or `{ ok: false, error }`.
struct APICallParams: Decodable, Equatable {
  let endpoint: String
  let body: [String: JSONValue]
}

struct APIError: Error, Codable, Equatable {
  enum Kind: String, Codable { case auth, network, http, parse }
  let kind: Kind
  var status: Int?
}

// Player: the hidden YouTube Music player. Every player request resolves with null.

struct SeekParams: Codable, Equatable {
  let seconds: Double
}

struct VolumeParams: Codable, Equatable {
  /// 0 to 1.
  let volume: Double
}

/// The track to play. `playlistId` and `index` give YouTube Music context; Melo's own queue decides what comes next.
struct LoadParams: Codable, Equatable {
  let videoId: String
  var playlistId: String?
  var index: Int?
}

extension LoadParams {
  // Ids are URL-safe base64, so anything else is refused before it reaches a URL or the page.
  init(from decoder: any Decoder) throws {
    enum Keys: String, CodingKey { case videoId, playlistId, index }
    let container = try decoder.container(keyedBy: Keys.self)
    videoId = try container.decode(String.self, forKey: .videoId)
    playlistId = try container.decodeIfPresent(String.self, forKey: .playlistId)
    index = try container.decodeIfPresent(Int.self, forKey: .index)
    guard isId(videoId) else {
      throw DecodingError.dataCorruptedError(forKey: .videoId, in: container, debugDescription: "Invalid videoId")
    }
    if let playlistId, !isId(playlistId) {
      throw DecodingError.dataCorruptedError(forKey: .playlistId, in: container, debugDescription: "Invalid playlistId")
    }
  }
}

/// Whether `id` looks like a YouTube id: letters, digits, `_` and `-`.
func isId(_ id: String) -> Bool {
  !id.isEmpty && id.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_" || $0 == "-") }
}

/// The `player.state` payload, sent on every state or track change and at most four times a second for the clock.
/// Metadata is what the page reports and stays nil until the requested track's media has loaded.
struct PlayerState: Codable, Equatable {
  enum Status: String, Codable { case idle, loading, playing, paused, ended, error }
  var status: Status
  var videoId: String?
  var title: String?
  var artist: String?
  var album: String?
  var artworkUrl: String?
  var currentTime: Double
  var duration: Double
  var volume: Double
  var isAd: Bool
  var error: String?

  static let idle = PlayerState(status: .idle, currentTime: 0, duration: 0, volume: 1, isAd: false)
}


// Queue: Melo's own queue, which lives in Swift so it keeps going while the window is hidden. Every queue request
// except `queue.get` resolves with null; `queue.changed` carries the new snapshot.

/// A track as the UI shows it. Swift only reads `videoId`; the rest is display metadata it hands back.
struct QueueItem: Codable, Equatable {
  struct Artist: Codable, Equatable {
    let name: String
    var browseId: String?
  }
  struct Album: Codable, Equatable {
    let name: String
    let browseId: String
  }
  let videoId: String
  let title: String
  let artists: [Artist]
  var album: Album?
  var durationSec: Double?
  var thumbnailUrl: String?
  var isVideo: Bool?

  init(
    videoId: String, title: String, artists: [Artist] = [], album: Album? = nil, durationSec: Double? = nil,
    thumbnailUrl: String? = nil, isVideo: Bool? = nil
  ) {
    self.videoId = videoId
    self.title = title
    self.artists = artists
    self.album = album
    self.durationSec = durationSec
    self.thumbnailUrl = thumbnailUrl
    self.isVideo = isVideo
  }

  init(from decoder: any Decoder) throws {
    enum Keys: String, CodingKey { case videoId, title, artists, album, durationSec, thumbnailUrl, isVideo }
    let container = try decoder.container(keyedBy: Keys.self)
    videoId = try container.decode(String.self, forKey: .videoId)
    guard isId(videoId) else {
      throw DecodingError.dataCorruptedError(forKey: .videoId, in: container, debugDescription: "Invalid videoId")
    }
    title = try container.decode(String.self, forKey: .title)
    artists = try container.decode([Artist].self, forKey: .artists)
    album = try container.decodeIfPresent(Album.self, forKey: .album)
    durationSec = try container.decodeIfPresent(Double.self, forKey: .durationSec)
    thumbnailUrl = try container.decodeIfPresent(String.self, forKey: .thumbnailUrl)
    isVideo = try container.decodeIfPresent(Bool.self, forKey: .isVideo)
  }
}

/// A queued item. `id` is unique within the queue, so the same song can be queued twice.
struct QueueEntry: Codable, Equatable {
  let id: Int
  let item: QueueItem
}

/// Where the queue came from, such as an album, shown as "Playing from".
struct QueueSource: Codable, Equatable {
  let title: String
  var browseId: String?
}

enum RepeatMode: String, Codable { case off, all, one }

struct QueueSetParams: Decodable, Equatable {
  let items: [QueueItem]
  let index: Int
  var source: QueueSource?
  /// The radio continuation, when the items are a radio's first page.
  var continuation: String?
}

struct QueueItemParams: Decodable, Equatable {
  let item: QueueItem
}

struct QueueIndexParams: Decodable, Equatable {
  let index: Int
}

struct QueueMoveParams: Decodable, Equatable {
  let from: Int
  let to: Int
}

struct QueueFlagParams: Decodable, Equatable {
  let enabled: Bool
}

struct QueueRepeatParams: Decodable, Equatable {
  let mode: RepeatMode
}

/// Radio items answering `queue.needsMore`. `after` echoes the request's, so a late answer for an old queue is dropped.
struct QueueAppendParams: Decodable, Equatable {
  let items: [QueueItem]
  var continuation: String?
  let after: Int
}

/// The `queue.changed` payload and the `queue.get` result. `index` is -1 when the queue is empty; entries before it
/// have played and entries after it are up next.
struct QueueSnapshot: Codable, Equatable {
  let items: [QueueEntry]
  let index: Int
  let source: QueueSource?
  let shuffle: Bool
  let `repeat`: RepeatMode
  let autoplay: Bool
}

/// Autoplay wants more radio: fetch `next` with `continuation` if given, otherwise the radio for `videoId`, and send
/// the songs with `queue.append`, echoing `after` (the id of the last queued entry).
struct NeedsMore: Codable, Equatable {
  let videoId: String
  let continuation: String?
  let after: Int
}

/// A track could not be played. `skipped` is false when too many failed in a row and the queue stopped instead.
struct Unplayable: Codable, Equatable {
  let videoId: String
  let title: String
  let skipped: Bool
}

// Library: like, save and subscribe state, shared between the main window and the menu bar and mini player pages.

/// One known state, as `ui/src/library.ts` keys it: `song:<videoId>`, `list:<playlistId>`, `artist:<channelId>` or
/// `row:<playlistId>:<setVideoId>`. `value` is a like status, a flag, or null to forget the key.
/// Swift only checks the shape and passes it to every page with `library.changed`.
struct LibraryChange: Codable, Equatable {
  enum Value: Codable, Equatable {
    case status(String), flag(Bool), none

    static let statuses: Set<String> = ["LIKE", "DISLIKE", "INDIFFERENT"]

    init(from decoder: any Decoder) throws {
      let container = try decoder.singleValueContainer()
      if container.decodeNil() {
        self = .none
      } else if let flag = try? container.decode(Bool.self) {
        self = .flag(flag)
      } else {
        let status = try container.decode(String.self)
        guard Self.statuses.contains(status) else {
          throw DecodingError.dataCorruptedError(in: container, debugDescription: "Invalid like status")
        }
        self = .status(status)
      }
    }

    func encode(to encoder: any Encoder) throws {
      var container = encoder.singleValueContainer()
      switch self {
      case .status(let status): try container.encode(status)
      case .flag(let flag): try container.encode(flag)
      case .none: try container.encodeNil()
      }
    }
  }

  let key: String
  let value: Value

  init(key: String, value: Value) {
    self.key = key
    self.value = value
  }

  init(from decoder: any Decoder) throws {
    enum Keys: String, CodingKey { case key, value }
    let container = try decoder.container(keyedBy: Keys.self)
    key = try container.decode(String.self, forKey: .key)
    value = try container.decodeIfPresent(Value.self, forKey: .value) ?? .none
    let parts = key.split(separator: ":", omittingEmptySubsequences: false).map(String.init)
    let valid =
      switch parts.first {
      case "song", "list", "artist": parts.count == 2 && isId(parts[1])
      case "row": parts.count == 3 && isId(parts[1]) && isId(parts[2])
      default: false
      }
    guard valid else { throw DecodingError.dataCorruptedError(forKey: .key, in: container, debugDescription: "Invalid key") }
  }
}

// Back and forward. The buttons sit in the native title bar; the history lives in the UI.

/// `nav.state`: whether the UI's history can go back or forward, so the title bar buttons can enable to match.
/// A song's link for the clipboard. Swift builds the URL from a checked video id, so a page can't put any other text
/// on the clipboard.
struct CopyLinkParams: Decodable, Equatable {
  let videoId: String

  init(videoId: String) { self.videoId = videoId }

  init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    videoId = try container.decode(String.self, forKey: .videoId)
    guard videoId.wholeMatch(of: /[A-Za-z0-9_-]{11}/) != nil else {
      throw DecodingError.dataCorruptedError(forKey: .videoId, in: container, debugDescription: "Not a video id")
    }
  }

  private enum CodingKeys: String, CodingKey { case videoId }

  var url: String { "https://music.youtube.com/watch?v=\(videoId)" }
}

struct NavState: Codable, Equatable {
  let canGoBack: Bool
  let canGoForward: Bool
}

/// `nav.go`: a title bar button was clicked.
struct NavGo: Codable, Equatable {
  enum Direction: String, Codable { case back, forward }
  let direction: Direction
}
