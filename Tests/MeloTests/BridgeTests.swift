import Foundation
import Testing

@testable import Melo

@Suite struct ProtocolTests {
  func decode(_ body: Any) throws -> Request {
    try JSONDecoder().decode(Request.self, from: JSONSerialization.data(withJSONObject: body))
  }

  @Test func decodesPing() throws {
    #expect(try decode(["method": "ping", "params": ["sentAt": 1234.5]]) == .ping(PingParams(sentAt: 1234.5)))
  }

  @Test func rejectsUnknownMethod() {
    #expect(throws: DecodingError.self) { try decode(["method": "pong", "params": [:]]) }
  }

  @Test func rejectsPingWithoutParams() {
    #expect(throws: DecodingError.self) { try decode(["method": "ping"]) }
  }

  @MainActor @Test func pingRepliesWithReceivedAt() async throws {
    let before = Date().timeIntervalSince1970 * 1000
    let reply = try #require(try await Bridge.handle(["method": "ping", "params": ["sentAt": 0]]) as? [String: Any])
    let receivedAt = try #require(reply["receivedAt"] as? Double)
    #expect(receivedAt >= before)
  }
}

@MainActor @Suite struct AppSchemeHandlerTests {
  let root = URL(fileURLWithPath: "/tmp/melo-ui")

  @Test func rootServesIndex() {
    #expect(AppSchemeHandler.file(for: URL(string: "melo://app/")!, in: root)?.path == "/tmp/melo-ui/index.html")
  }

  @Test func servesNestedAssets() {
    let file = AppSchemeHandler.file(for: URL(string: "melo://app/assets/index.js")!, in: root)
    #expect(file?.path == "/tmp/melo-ui/assets/index.js")
  }

  @Test func refusesPathsOutsideRoot() {
    #expect(AppSchemeHandler.file(for: URL(string: "melo://app/../secret")!, in: root) == nil)
    #expect(AppSchemeHandler.file(for: URL(string: "melo://app/%2E%2E/secret")!, in: root) == nil)
  }

  @Test(arguments: [
    ("index.html", "text/html"), ("index.js", "text/javascript"), ("index.css", "text/css"), ("font.woff2", "font/woff2"),
  ])
  func mimeTypes(name: String, type: String) {
    #expect(AppSchemeHandler.mimeType(for: URL(fileURLWithPath: name)) == type)
  }
}
