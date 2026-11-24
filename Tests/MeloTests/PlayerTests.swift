import Foundation
import Testing

@testable import Melo

@Suite struct PlayerProtocolTests {
  func decode(_ body: Any) throws -> Request {
    try JSONDecoder().decode(Request.self, from: JSONSerialization.data(withJSONObject: body))
  }

  @Test func decodesPlayerRequests() throws {
    #expect(try decode(["method": "player.play", "params": [:]]) == .playerPlay)
    #expect(try decode(["method": "player.pause", "params": [:]]) == .playerPause)
    #expect(try decode(["method": "player.toggle", "params": [:]]) == .playerToggle)
    #expect(try decode(["method": "player.seek", "params": ["seconds": 30.5]]) == .playerSeek(SeekParams(seconds: 30.5)))
    #expect(
      try decode(["method": "player.setVolume", "params": ["volume": 0.4]]) == .playerSetVolume(VolumeParams(volume: 0.4)))
    #expect(
      try decode(["method": "player.load", "params": ["videoId": "7qQg6YbSMko", "playlistId": "OLAK5uy_x-1", "index": 2]])
        == .playerLoad(LoadParams(videoId: "7qQg6YbSMko", playlistId: "OLAK5uy_x-1", index: 2)))
  }

  @Test(arguments: ["", "abc');alert(1)//", "a b", "a/b", "</script>", "é"])
  func rejectsUnsafeIds(id: String) {
    #expect(throws: DecodingError.self) { try decode(["method": "player.load", "params": ["videoId": id]]) }
    #expect(throws: DecodingError.self) {
      try decode(["method": "player.load", "params": ["videoId": "7qQg6YbSMko", "playlistId": id]])
    }
  }

  @Test func rejectsSeekWithoutSeconds() {
    #expect(throws: DecodingError.self) { try decode(["method": "player.seek", "params": [:]]) }
  }

  @MainActor @Test func encodesPlayerStateEvent() throws {
    var state = PlayerState.idle
    state.status = .playing
    state.videoId = "7qQg6YbSMko"
    state.currentTime = 12.5
    let event = try #require(try Bridge.json(Event.playerState(state)) as? [String: Any])
    #expect(event["name"] as? String == "player.state")
    let payload = try #require(event["payload"] as? [String: Any])
    #expect(payload["status"] as? String == "playing")
    #expect(payload["currentTime"] as? Double == 12.5)
  }
}

@MainActor @Suite struct PlayerTests {
  let state: [String: Any] = [
    "status": "paused", "videoId": "7qQg6YbSMko", "title": "Prélude", "artist": "Pablo Casals", "album": NSNull(),
    "artworkUrl": "https://lh3.googleusercontent.com/x", "currentTime": 3.25, "duration": 149, "volume": 0,
    "isAd": false, "error": NSNull(),
  ]

  func decode(_ body: Any, mainFrame: Bool = true, scheme: String = "https", host: String = "music.youtube.com")
    -> PlayerMessage?
  {
    Player.decode(body, isMainFrame: mainFrame, scheme: scheme, host: host)
  }

  @Test func decodesStateMessage() throws {
    let message = try #require(decode(["generation": 3, "state": state]))
    #expect(message.generation == 3)
    #expect(message.state.status == .paused)
    #expect(message.state.title == "Prélude")
    #expect(message.state.album == nil)
    #expect(message.state.duration == 149)
  }

  @Test func dropsForeignFramesAndOrigins() {
    let body: [String: Any] = ["generation": 3, "state": state]
    #expect(decode(body, mainFrame: false) == nil)
    #expect(decode(body, host: "evil.example") == nil)
    #expect(decode(body, host: "music.youtube.com.evil.example") == nil)
    #expect(decode(body, scheme: "http") == nil)
  }

  @Test func dropsMalformedMessages() {
    var badStatus = state
    badStatus["status"] = "rewinding"
    var missingTime = state
    missingTime["currentTime"] = nil
    for body: Any in [
      "state", 42, ["generation": 3], ["generation": "3", "state": state], ["generation": 3, "state": badStatus],
      ["generation": 3, "state": missingTime],
    ] {
      #expect(decode(body) == nil)
    }
  }

  @Test func commandsPassValuesAsArguments() {
    let params = LoadParams(videoId: "7qQg6YbSMko", playlistId: "PL1", index: 4)
    let arguments = PlayerCommand.navigate(params).arguments(generation: 7)
    #expect(arguments["generation"] as? Int == 7)
    #expect(arguments["name"] as? String == "navigate")
    let endpoint = arguments["argument"] as? [String: Any]
    #expect(endpoint?["videoId"] as? String == "7qQg6YbSMko")
    #expect(endpoint?["playlistId"] as? String == "PL1")
    #expect(endpoint?["index"] as? Int == 4)
    #expect(PlayerCommand.seek(30).arguments(generation: 1)["argument"] as? Double == 30)
    #expect(PlayerCommand.play.arguments(generation: 1)["argument"] is NSNull)
    // The source is constant, so no value can change what runs.
    #expect(!PlayerCommand.script.contains("7qQg6YbSMko"))
  }

  @Test func watchURLCarriesGenerationAndEncodesQuery() {
    let url = Player.watchURL(LoadParams(videoId: "7qQg6YbSMko", playlistId: "RDAMVM7qQg6YbSMko", index: 1), generation: 5)
    #expect(
      url.absoluteString
        == "https://music.youtube.com/watch?v=7qQg6YbSMko&list=RDAMVM7qQg6YbSMko&index=1&meloGeneration=5#meloGeneration=5")
    #expect(Player.homeURL(generation: 2).absoluteString == "https://music.youtube.com/?meloGeneration=2#meloGeneration=2")
  }

  @Test func userScriptBakesInJSONBootValues() {
    let script = Player.userScript(volume: 0.25, autoplay: false, resumeAt: 61.5)
    #expect(script.hasSuffix(#"})({"autoplay":false,"resumeAt":61.5,"volume":0.25});"#))
    #expect(script.contains("const PlayerCore"))
    #expect(script.contains("window.__meloPlayer"))
  }
}

@MainActor @Suite struct PlayerAccountTests {
  @Test func decodesThePageSignIn() throws {
    let state: [String: Any] = ["status": "idle", "currentTime": 0, "duration": 0, "volume": 1, "isAd": false]
    let signedIn = try #require(
      Player.decode(["generation": 1, "loggedIn": true, "state": state], isMainFrame: true, scheme: "https", host: "music.youtube.com"))
    #expect(signedIn.loggedIn == true)
    let unknown = try #require(
      Player.decode(["generation": 1, "state": state], isMainFrame: true, scheme: "https", host: "music.youtube.com"))
    #expect(unknown.loggedIn == nil)
    #expect(
      Player.decode(["generation": 1, "loggedIn": "yes", "state": state], isMainFrame: true, scheme: "https", host: "music.youtube.com")
        == nil)
  }

  @MainActor @Test func reloadsAPageLoadedBeforeSignIn() {
    #expect(Player.needsReload(signedIn: true, pageLoggedIn: false, reloadedFor: nil))
    #expect(Player.needsReload(signedIn: false, pageLoggedIn: true, reloadedFor: nil))
  }

  @MainActor @Test func leavesAMatchingOrUnknownPageAlone() {
    #expect(!Player.needsReload(signedIn: true, pageLoggedIn: true, reloadedFor: nil))
    #expect(!Player.needsReload(signedIn: nil, pageLoggedIn: false, reloadedFor: nil))
    #expect(!Player.needsReload(signedIn: true, pageLoggedIn: nil, reloadedFor: nil))
  }

  @MainActor @Test func reloadsOnlyOncePerSignIn() {
    // A page that stays signed out after the reload must not reload forever.
    #expect(!Player.needsReload(signedIn: true, pageLoggedIn: false, reloadedFor: true))
  }
}
