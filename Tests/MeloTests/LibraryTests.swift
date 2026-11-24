// Library: the like, save and subscribe state shared between pages through `library.broadcast` and
// `library.changed`, and the add-to-playlist endpoint.
import Foundation
import Testing

@testable import Melo

@Suite struct LibraryProtocolTests {
  func decode(_ body: Any) throws -> Request {
    try JSONDecoder().decode(Request.self, from: JSONSerialization.data(withJSONObject: body))
  }

  @Test func decodesBroadcasts() throws {
    #expect(
      try decode(["method": "library.broadcast", "params": ["key": "song:abc_D-1", "value": "LIKE"]])
        == .libraryBroadcast(LibraryChange(key: "song:abc_D-1", value: .status("LIKE"))))
    #expect(
      try decode(["method": "library.broadcast", "params": ["key": "list:PLx", "value": true]])
        == .libraryBroadcast(LibraryChange(key: "list:PLx", value: .flag(true))))
    #expect(
      try decode(["method": "library.broadcast", "params": ["key": "row:PLx:set1", "value": NSNull()]])
        == .libraryBroadcast(LibraryChange(key: "row:PLx:set1", value: .none)))
    #expect(
      try decode(["method": "library.broadcast", "params": ["key": "artist:UCx"]])
        == .libraryBroadcast(LibraryChange(key: "artist:UCx", value: .none)))
  }

  @Test(arguments: [
    #"{"key": "song:abc", "value": "LOVE"}"#,
    #"{"key": "song:abc", "value": 1}"#,
    #"{"key": "song:a b", "value": "LIKE"}"#,
    #"{"key": "album:abc", "value": true}"#,
    #"{"key": "song:abc:def", "value": true}"#,
    #"{"key": "row:PLx", "value": true}"#,
    #"{"key": "song:", "value": true}"#,
    #"{"value": true}"#,
  ])
  func rejectsBadBroadcasts(params: String) throws {
    let params = try JSONSerialization.jsonObject(with: Data(params.utf8))
    #expect(throws: DecodingError.self) { try decode(["method": "library.broadcast", "params": params]) }
  }

  @MainActor @Test func encodesLibraryChanged() throws {
    let liked = try #require(
      try Bridge.json(Event.libraryChanged(LibraryChange(key: "song:abc", value: .status("LIKE")))) as? [String: Any])
    #expect(liked["name"] as? String == "library.changed")
    let payload = try #require(liked["payload"] as? [String: Any])
    #expect(payload["key"] as? String == "song:abc")
    #expect(payload["value"] as? String == "LIKE")
    let forgotten = try #require(
      try Bridge.json(Event.libraryChanged(LibraryChange(key: "list:PLx", value: .none))) as? [String: Any])
    #expect((forgotten["payload"] as? [String: Any])?["value"] is NSNull)
  }

  @Test func allowsAddToPlaylist() throws {
    _ = try InnerTube.request(endpoint: "playlist/get_add_to_playlist", body: [:], apiKey: "KEY", credentials: nil)
  }
}
