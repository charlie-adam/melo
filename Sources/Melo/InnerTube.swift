// InnerTube transport: POST https://music.youtube.com/youtubei/v1/<endpoint> with the WEB_REMIX context, signed with
// SAPISIDHASH when signed in. Responses go back to the UI as raw JSON; parsing lives in ui/src/api.
import CryptoKit
import Foundation
import OSLog

private let apiLog = Logger(subsystem: "com.charlieadam.melo", category: "innertube")

enum InnerTube {
  static let origin = "https://music.youtube.com"
  static let userAgent =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
  // Hardcoded in Kaset since 2023 and still accepted.
  static let clientVersion = "1.20231204.01.00"

  /// The endpoints the UI may reach through `api.call`.
  static let endpoints: Set<String> = [
    "browse", "search", "music/get_search_suggestions", "next",
    "like/like", "like/dislike", "like/removelike",
    "playlist/create", "playlist/get_add_to_playlist", "browse/edit_playlist", "feedback",
    "subscription/subscribe", "subscription/unsubscribe", "account/account_menu",
  ]

  /// Endpoints that only read, so a failed call can be sent again. Mutations are never retried automatically: a
  /// like or playlist edit that timed out may still have landed.
  static let reads: Set<String> = [
    "browse", "search", "music/get_search_suggestions", "next", "account/account_menu", "playlist/get_add_to_playlist",
  ]
  static let retryDelay = Duration.seconds(1)

  /// Whether a failed call is worth one more try: a read that hit the network, a 5xx or a 429.
  static func shouldRetry(_ endpoint: String, after error: APIError) -> Bool {
    guard reads.contains(endpoint) else { return false }
    switch error.kind {
    case .network: return true
    case .http: return error.status == 429 || (error.status ?? 0) >= 500
    case .auth, .parse: return false
    }
  }

  struct Credentials: Equatable {
    let cookieHeader: String
    let sapisid: String
  }

  struct UnknownEndpoint: Error, CustomStringConvertible {
    let endpoint: String
    var description: String { "Endpoint not allowed: \(endpoint)" }
  }

  /// `<timestamp>_<sha1 hex of "timestamp sapisid origin">`, the value after `SAPISIDHASH ` in Authorization.
  static func sapisidHash(_ sapisid: String, timestamp: Int) -> String {
    let digest = Insecure.SHA1.hash(data: Data("\(timestamp) \(sapisid) \(origin)".utf8))
    return "\(timestamp)_" + digest.map { String(format: "%02x", $0) }.joined()
  }

  static func context(timeZone: TimeZone) -> [String: Any] {
    [
      "client": [
        "clientName": "WEB_REMIX", "clientVersion": clientVersion,
        "hl": "en", "gl": "US", "platform": "DESKTOP",
        "browserName": "Safari", "browserVersion": "17.0",
        "osName": "Macintosh", "osVersion": "10_15_7",
        "userAgent": userAgent,
        // Positive east of UTC: Tokyo is +540.
        "utcOffsetMinutes": timeZone.secondsFromGMT() / 60,
        "experimentIds": [], "experimentsToken": "",
      ] as [String: Any],
      "user": ["lockedSafetyMode": false],
    ]
  }

  static func request(
    endpoint: String, body: [String: Any], apiKey: String, credentials: Credentials?,
    now: Date = Date(), timeZone: TimeZone = .current
  ) throws -> URLRequest {
    guard endpoints.contains(endpoint) else { throw UnknownEndpoint(endpoint: endpoint) }
    var components = URLComponents(string: "\(origin)/youtubei/v1/\(endpoint)")!
    components.queryItems = [URLQueryItem(name: "key", value: apiKey), URLQueryItem(name: "prettyPrint", value: "false")]
    var request = URLRequest(url: components.url!)
    request.httpMethod = "POST"
    request.httpShouldHandleCookies = false
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue(origin, forHTTPHeaderField: "Origin")
    request.setValue(origin, forHTTPHeaderField: "Referer")
    if let credentials {
      let hash = sapisidHash(credentials.sapisid, timestamp: Int(now.timeIntervalSince1970))
      request.setValue(credentials.cookieHeader, forHTTPHeaderField: "Cookie")
      request.setValue("SAPISIDHASH \(hash)", forHTTPHeaderField: "Authorization")
      request.setValue(origin, forHTTPHeaderField: "X-Origin")
      request.setValue("0", forHTTPHeaderField: "X-Goog-AuthUser")
    }
    var body = body
    body["context"] = context(timeZone: timeZone)
    request.httpBody = try JSONSerialization.data(withJSONObject: body)
    return request
  }

  /// A log line for a request: the endpoint and each header's name and length, never a header value.
  static func logSummary(_ request: URLRequest) -> String {
    let headers = (request.allHTTPHeaderFields ?? [:]).sorted { $0.key < $1.key }.map { "\($0.key)(\($0.value.count))" }
    return "\(request.url?.path ?? "?") headers: \(headers.joined(separator: " "))"
  }

  /// nil for a 2xx status. 401 and 403 are auth failures, which must never delete stored credentials.
  static func error(forStatus status: Int) -> APIError? {
    switch status {
    case 200..<300: nil
    case 401, 403: APIError(kind: .auth, status: status)
    default: APIError(kind: .http, status: status)
    }
  }

  /// `responseContext.serviceTrackingParams[].params[]` where key is `logged_in`: "1" signed in, "0" signed out.
  static func loggedIn(_ json: Any) -> String? {
    let context = (json as? [String: Any])?["responseContext"] as? [String: Any]
    let services = context?["serviceTrackingParams"] as? [[String: Any]] ?? []
    let params = services.flatMap { $0["params"] as? [[String: Any]] ?? [] }
    return params.first { $0["key"] as? String == "logged_in" }?["value"] as? String
  }

  /// A signed-in request whose 200 response says `logged_in` "0" is an auth failure: YouTube answers a rejected
  /// SAPISIDHASH or a dead session with the anonymous response instead of a 401.
  static func error(forSignedInResponse json: Any, status: Int) -> APIError? {
    loggedIn(json) == "0" ? APIError(kind: .auth, status: status) : nil
  }

  static func apiKey(fromHTML html: String) -> String? {
    guard let match = html.firstMatch(of: #/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/#) else { return nil }
    return String(match.1)
  }
}

@MainActor
final class InnerTubeClient {
  static let shared = InnerTubeClient()

  let session: URLSession
  private var apiKey: Task<String, any Error>?

  /// Ephemeral, with no cookie handling of its own. A call gives up after 10 s without data, or 30 s in all.
  static func configuration() -> URLSessionConfiguration {
    let configuration = URLSessionConfiguration.ephemeral
    // No Accept-Encoding: setting it by hand stops URLSession decompressing Brotli.
    configuration.httpAdditionalHeaders = ["User-Agent": InnerTube.userAgent]
    configuration.httpCookieAcceptPolicy = .never
    configuration.httpShouldSetCookies = false
    configuration.timeoutIntervalForRequest = 10
    configuration.timeoutIntervalForResource = 30
    return configuration
  }

  init(session: URLSession = URLSession(configuration: InnerTubeClient.configuration())) {
    self.session = session
  }

  /// Posts to an allowlisted endpoint and returns the parsed JSON object. Throws `APIError`, or `UnknownEndpoint`.
  /// Sends the signed-in cookies unless `signedOut` is set. A read that fails on the network or with a 5xx or 429 is
  /// sent once more after `InnerTube.retryDelay`; a mutation never is.
  func call(_ endpoint: String, body: [String: Any], signedOut: Bool = false) async throws -> Any {
    guard InnerTube.endpoints.contains(endpoint) else { throw InnerTube.UnknownEndpoint(endpoint: endpoint) }
    do {
      return try await attempt(endpoint, body: body, signedOut: signedOut)
    } catch let error as APIError where InnerTube.shouldRetry(endpoint, after: error) {
      apiLog.info("\(endpoint, privacy: .public) failed (\(error.kind.rawValue, privacy: .public)); retrying once")
      try await Task.sleep(for: InnerTube.retryDelay)
      return try await attempt(endpoint, body: body, signedOut: signedOut)
    }
  }

  private func attempt(_ endpoint: String, body: [String: Any], signedOut: Bool) async throws -> Any {
    let credentials = signedOut ? nil : await Auth.shared.credentials()
    let request = try InnerTube.request(
      endpoint: endpoint, body: body, apiKey: try await key(), credentials: credentials)
    apiLog.debug("\(InnerTube.logSummary(request), privacy: .public)")
    let (data, status) = try await send(request)
    if let error = InnerTube.error(forStatus: status) {
      apiLog.error("\(endpoint, privacy: .public) returned HTTP \(status)")
      if error.kind == .auth, credentials != nil { Auth.shared.markExpired() }
      throw error
    }
    guard let json = try? JSONSerialization.jsonObject(with: data), json is [String: Any] else {
      throw APIError(kind: .parse, status: status)
    }
    if credentials != nil, let error = InnerTube.error(forSignedInResponse: json, status: status) {
      apiLog.error("\(endpoint, privacy: .public) answered signed out (logged_in=0)")
      Auth.shared.markExpired()
      throw error
    }
    apiLog.debug("\(endpoint, privacy: .public) 200, \(data.count) bytes, signedIn=\(credentials != nil)")
    return json
  }

  func send(_ request: URLRequest) async throws -> (Data, Int) {
    do {
      let (data, response) = try await session.data(for: request)
      return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
    } catch {
      throw APIError(kind: .network)
    }
  }

  /// The public web client key, scraped from a cookieless page load with consent pre-accepted, cached in memory.
  func key() async throws -> String {
    if let apiKey, let key = try? await apiKey.value { return key }
    let task = Task {
      var request = URLRequest(url: URL(string: InnerTube.origin)!)
      request.httpShouldHandleCookies = false
      request.setValue("SOCS=CAI", forHTTPHeaderField: "Cookie")
      let (data, status) = try await self.send(request)
      if let error = InnerTube.error(forStatus: status) { throw error }
      guard let key = InnerTube.apiKey(fromHTML: String(decoding: data, as: UTF8.self)) else {
        throw APIError(kind: .parse, status: status)
      }
      return key
    }
    apiKey = task
    do {
      return try await task.value
    } catch {
      apiKey = nil
      throw error
    }
  }
}

/// Any JSON value, so `api.call` can carry an arbitrary InnerTube body through Codable.
enum JSONValue: Codable, Equatable {
  case null, bool(Bool), number(Double), string(String), array([JSONValue]), object([String: JSONValue])

  init(from decoder: any Decoder) throws {
    let container = try decoder.singleValueContainer()
    if container.decodeNil() {
      self = .null
    } else if let value = try? container.decode(Bool.self) {
      self = .bool(value)
    } else if let value = try? container.decode(Double.self) {
      self = .number(value)
    } else if let value = try? container.decode(String.self) {
      self = .string(value)
    } else if let value = try? container.decode([JSONValue].self) {
      self = .array(value)
    } else {
      self = .object(try container.decode([String: JSONValue].self))
    }
  }

  func encode(to encoder: any Encoder) throws {
    var container = encoder.singleValueContainer()
    switch self {
    case .null: try container.encodeNil()
    case .bool(let value): try container.encode(value)
    case .number(let value): try container.encode(value)
    case .string(let value): try container.encode(value)
    case .array(let value): try container.encode(value)
    case .object(let value): try container.encode(value)
    }
  }
}
