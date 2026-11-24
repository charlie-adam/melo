// LRCLIB (https://lrclib.net), a free lyrics database, as the fallback and the main source of synced lines.
// Swift makes the request so the UI keeps a connect-src of 'self'; the host is fixed
// here, and only the fields the UI needs go back. Choosing the best result happens in ui/src/lyrics.ts.
import Foundation
import OSLog

private let lyricsLog = Logger(subsystem: "com.charlieadam.melo", category: "lyrics")

/// `lyrics.lrclib` params. `durationSec` is the track's length, which the UI matches results against.
struct LrclibParams: Decodable, Equatable {
  let title: String
  let artist: String
  let durationSec: Double
}

/// One LRCLIB result, trimmed to what the UI reads.
struct LrclibResult: Codable, Equatable {
  let durationSec: Double
  var plainLyrics: String?
  var syncedLyrics: String?
}

enum Lrclib {
  static let host = "lrclib.net"
  /// LRCLIB asks clients to name themselves. This names the app and nothing about the user.
  static let userAgent = "Melo/0.1 (macOS YouTube Music client)"
  static let timeout: TimeInterval = 8
  /// Results past this many are ignored; search ranks the likely matches first.
  static let limit = 20

  static func request(_ params: LrclibParams) -> URLRequest {
    var components = URLComponents()
    components.scheme = "https"
    components.host = host
    components.path = "/api/search"
    components.queryItems = [
      URLQueryItem(name: "track_name", value: params.title), URLQueryItem(name: "artist_name", value: params.artist),
    ]
    var request = URLRequest(url: components.url!, timeoutInterval: timeout)
    request.httpShouldHandleCookies = false
    request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    return request
  }

  /// Decodes a search response, dropping instrumentals and entries with no lyrics, and keeps only the needed fields.
  static func trim(_ data: Data) throws -> [LrclibResult] {
    struct Raw: Decodable {
      let duration: Double?
      let instrumental: Bool?
      let plainLyrics: String?
      let syncedLyrics: String?
    }
    func text(_ s: String?) -> String? {
      guard let s, !s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
      return s
    }
    return try JSONDecoder().decode([Raw].self, from: data).prefix(limit).compactMap { raw in
      guard raw.instrumental != true, let duration = raw.duration else { return nil }
      let plain = text(raw.plainLyrics)
      let synced = text(raw.syncedLyrics)
      guard plain != nil || synced != nil else { return nil }
      return LrclibResult(durationSec: duration, plainLyrics: plain, syncedLyrics: synced)
    }
  }

  /// Searches LRCLIB. Any failure resolves with no results, since lyrics are optional.
  static func search(_ params: LrclibParams, session: URLSession = .shared) async -> [LrclibResult] {
    do {
      let (data, response) = try await session.data(for: request(params))
      guard (response as? HTTPURLResponse)?.statusCode == 200 else { return [] }
      let results = try trim(data)
      lyricsLog.info("LRCLIB returned \(results.count) usable results")
      return results
    } catch {
      lyricsLog.info("LRCLIB failed: \(error.localizedDescription, privacy: .public)")
      return []
    }
  }
}
