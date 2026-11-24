// Sign-in and InnerTube transport: SAPISIDHASH, request building, error classification, the endpoint allowlist,
// cookie selection and the Keychain archive format, plus decoding of the auth and api messages.
import Foundation
import Testing

@testable import Melo

@Suite struct InnerTubeTests {
  let credentials = InnerTube.Credentials(cookieHeader: "SAPISID=abc123; SID=s", sapisid: "abc123")
  let now = Date(timeIntervalSince1970: 1_700_000_000)
  let tokyo = TimeZone(identifier: "Asia/Tokyo")!

  func build(_ credentials: InnerTube.Credentials?) throws -> URLRequest {
    try InnerTube.request(
      endpoint: "browse", body: ["browseId": "FEmusic_home"], apiKey: "KEY", credentials: credentials, now: now,
      timeZone: tokyo)
  }

  func body(_ request: URLRequest) throws -> [String: Any] {
    let data = try #require(request.httpBody)
    return try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
  }

  @Test func sapisidHashMatchesKnownVector() {
    // printf '1700000000 abc123 https://music.youtube.com' | shasum -a 1
    #expect(InnerTube.sapisidHash("abc123", timestamp: 1_700_000_000)
      == "1700000000_597a8411c1c01f9c14cea84b6ec377b76d93be6e")
  }

  @Test func signedInRequestCarriesAuthHeaders() throws {
    let request = try build(credentials)
    #expect(request.httpMethod == "POST")
    #expect(request.url?.absoluteString == "https://music.youtube.com/youtubei/v1/browse?key=KEY&prettyPrint=false")
    #expect(request.value(forHTTPHeaderField: "Authorization")
      == "SAPISIDHASH 1700000000_597a8411c1c01f9c14cea84b6ec377b76d93be6e")
    #expect(request.value(forHTTPHeaderField: "Cookie") == "SAPISID=abc123; SID=s")
    #expect(request.value(forHTTPHeaderField: "X-Goog-AuthUser") == "0")
    #expect(request.value(forHTTPHeaderField: "X-Origin") == "https://music.youtube.com")
    #expect(request.value(forHTTPHeaderField: "Origin") == "https://music.youtube.com")
    #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
    #expect(request.value(forHTTPHeaderField: "Accept-Encoding") == nil)
    #expect(!request.httpShouldHandleCookies)
  }

  @Test func signedOutRequestSendsNoCredentials() throws {
    let request = try build(nil)
    for header in ["Authorization", "Cookie", "X-Goog-AuthUser", "X-Origin"] {
      #expect(request.value(forHTTPHeaderField: header) == nil)
    }
    #expect(request.value(forHTTPHeaderField: "Referer") == "https://music.youtube.com")
  }

  @Test func bodyKeepsParamsAndAddsWebRemixContext() throws {
    let body = try body(build(nil))
    #expect(body["browseId"] as? String == "FEmusic_home")
    let client = try #require((body["context"] as? [String: Any])?["client"] as? [String: Any])
    #expect(client["clientName"] as? String == "WEB_REMIX")
    #expect(client["clientVersion"] as? String == "1.20231204.01.00")
    #expect(client["utcOffsetMinutes"] as? Int == 540)
    #expect(((body["context"] as? [String: Any])?["user"] as? [String: Any])?["lockedSafetyMode"] as? Bool == false)
  }

  @Test func refusesEndpointsOutsideAllowlist() {
    #expect(throws: InnerTube.UnknownEndpoint.self) {
      try InnerTube.request(endpoint: "player", body: [:], apiKey: "KEY", credentials: nil)
    }
    #expect(throws: InnerTube.UnknownEndpoint.self) {
      try InnerTube.request(endpoint: "../browse", body: [:], apiKey: "KEY", credentials: nil)
    }
  }

  @Test(arguments: ["browse", "search", "music/get_search_suggestions", "next", "like/like", "account/account_menu"])
  func allowsEndpointsWeUse(endpoint: String) throws {
    _ = try InnerTube.request(endpoint: endpoint, body: [:], apiKey: "KEY", credentials: nil)
  }

  @Test func logSummaryShowsHeaderNamesAndLengthsOnly() throws {
    let summary = InnerTube.logSummary(try build(credentials))
    #expect(summary.contains("/youtubei/v1/browse"))
    #expect(summary.contains("Cookie(\(credentials.cookieHeader.count))"))
    #expect(summary.contains("Authorization("))
    for secret in ["abc123", "SID=s", "597a8411", "KEY"] { #expect(!summary.contains(secret)) }
  }

  @Test func classifiesStatuses() {
    #expect(InnerTube.error(forStatus: 200) == nil)
    #expect(InnerTube.error(forStatus: 401) == APIError(kind: .auth, status: 401))
    #expect(InnerTube.error(forStatus: 403) == APIError(kind: .auth, status: 403))
    #expect(InnerTube.error(forStatus: 400) == APIError(kind: .http, status: 400))
    #expect(InnerTube.error(forStatus: 503) == APIError(kind: .http, status: 503))
  }

  func response(loggedIn: String?) -> [String: Any] {
    let params: [[String: Any]] = loggedIn.map { [["key": "logged_in", "value": $0]] } ?? []
    return ["responseContext": ["serviceTrackingParams": [["service": "GFEEDBACK", "params": params]]], "contents": [:]]
  }

  @Test func signedInResponseServedSignedOutIsAnAuthError() {
    #expect(InnerTube.error(forSignedInResponse: response(loggedIn: "0"), status: 200) == APIError(kind: .auth, status: 200))
    #expect(InnerTube.error(forSignedInResponse: response(loggedIn: "1"), status: 200) == nil)
    // Mutations and suggestions carry no logged_in at all, which is not a failure.
    #expect(InnerTube.error(forSignedInResponse: response(loggedIn: nil), status: 200) == nil)
    #expect(InnerTube.error(forSignedInResponse: ["likeStatus": "LIKE"], status: 200) == nil)
  }

  @Test func scrapesAPIKey() {
    #expect(InnerTube.apiKey(fromHTML: #"ytcfg.set({"INNERTUBE_API_KEY": "AIzaTest_-1","X":1})"#) == "AIzaTest_-1")
    #expect(InnerTube.apiKey(fromHTML: "<html>consent</html>") == nil)
  }
}

@Suite struct AuthCookieTests {
  let now = Date(timeIntervalSince1970: 1_700_000_000)

  func cookie(_ name: String, _ value: String = "v", domain: String = ".youtube.com", expires: TimeInterval = 3600)
    -> HTTPCookie
  {
    HTTPCookie(properties: [
      .name: name, .value: value, .domain: domain, .path: "/", .secure: "TRUE",
      .expires: now.addingTimeInterval(expires),
    ])!
  }

  @Test func prefersSecure3PAPISID() throws {
    let found = try #require(
      Auth.credentials(from: [cookie("SAPISID", "plain"), cookie("__Secure-3PAPISID", "secure")], now: now))
    #expect(found.sapisid == "secure")
    #expect(found.cookieHeader.contains("SAPISID=plain"))
  }

  @Test func expired3PCookieMeansSignedOut() {
    #expect(Auth.credentials(from: [cookie("SAPISID"), cookie("__Secure-3PAPISID", expires: -1)], now: now) == nil)
  }

  @Test func ignoresGoogleCookiesForHeaders() {
    #expect(Auth.credentials(from: [cookie("SAPISID", domain: ".google.com")], now: now) == nil)
  }

  @Test func backsUpOnlyAllowlistedLiveCookies() {
    #expect(Auth.isBackedUp(cookie("SID", domain: ".google.com"), now: now))
    #expect(Auth.isBackedUp(cookie("SAPISID"), now: now))
    #expect(!Auth.isBackedUp(cookie("PREF"), now: now))
    #expect(!Auth.isBackedUp(cookie("SID", domain: ".example.com"), now: now))
    #expect(!Auth.isBackedUp(cookie("SID", expires: -1), now: now))
  }

  @Test func archiveRoundTrips() throws {
    let cookies = [cookie("SAPISID", "a"), cookie("SID", "b", domain: ".google.com")]
    let restored = Auth.unarchive(try #require(Auth.archive(cookies)))
    #expect(restored.map(\.name) == ["SAPISID", "SID"])
    #expect(restored.map(\.value) == ["a", "b"])
    #expect(restored.map(\.domain) == [".youtube.com", ".google.com"])
    #expect(restored.first?.expiresDate == cookies.first?.expiresDate)
  }

  @Test func loginSnapshotChangesWithNewSession() {
    #expect(Auth.loginSnapshot([cookie("SID", "old")]) != Auth.loginSnapshot([cookie("SID", "new")]))
  }
}

@Suite struct KeysProtocolTests {
  func decode(_ body: Any) throws -> Request {
    try JSONDecoder().decode(Request.self, from: JSONSerialization.data(withJSONObject: body))
  }

  @Test func decodesAuthMethods() throws {
    #expect(try decode(["method": "auth.status", "params": [:]]) == .authStatus)
    #expect(try decode(["method": "auth.signIn", "params": [:]]) == .authSignIn)
    #expect(try decode(["method": "auth.signOut", "params": [:]]) == .authSignOut)
  }

  @Test func decodesAPICallWithArbitraryBody() throws {
    let request = try decode([
      "method": "api.call",
      "params": ["endpoint": "search", "body": ["query": "q", "n": 2, "on": true, "ids": ["a"], "x": NSNull()]],
    ])
    #expect(request == .apiCall(APICallParams(endpoint: "search", body: [
      "query": .string("q"), "n": .number(2), "on": .bool(true), "ids": .array([.string("a")]), "x": .null,
    ])))
  }

  @Test func rejectsMalformedAPICall() {
    for params: Any in [["body": [:]], ["endpoint": 1, "body": [:]], ["endpoint": "browse", "body": ["a"]],
      ["endpoint": "browse"]] as [Any]
    {
      #expect(throws: DecodingError.self) { try decode(["method": "api.call", "params": params]) }
    }
  }

  @MainActor @Test func unknownEndpointRejectsTheRequest() async {
    await #expect(throws: InnerTube.UnknownEndpoint.self) {
      try await Bridge.handle(["method": "api.call", "params": ["endpoint": "player", "body": [:]]])
    }
  }

  @MainActor @Test func encodesAuthChanged() throws {
    let event = try #require(try Bridge.json(Event.authChanged(AuthStatus(signedIn: true, expired: true))) as? [String: Any])
    #expect(event["name"] as? String == "auth.changed")
    #expect((event["payload"] as? [String: Any])?["expired"] as? Bool == true)
  }

  @Test func encodesAPIErrorWithoutStatusWhenAbsent() throws {
    let error = try JSONSerialization.jsonObject(with: JSONEncoder().encode(APIError(kind: .network))) as? [String: Any]
    #expect(error?["kind"] as? String == "network")
    #expect(error?["status"] == nil)
  }
}

@Suite struct UINavigationTests {
  let dev = URL(string: "http://127.0.0.1:5173/")!

  @Test func allowsOnlyTheAppOrigin() {
    #expect(UINavigation.isApp(URL(string: "melo://app/")!, devURL: nil))
    #expect(UINavigation.isApp(URL(string: "melo://app/assets/index.js")!, devURL: nil))
    #expect(!UINavigation.isApp(URL(string: "melo://other/")!, devURL: nil))
    #expect(!UINavigation.isApp(URL(string: "https://music.youtube.com/")!, devURL: nil))
    #expect(!UINavigation.isApp(URL(string: "http://127.0.0.1:5173/")!, devURL: nil))
  }

  @Test func allowsTheDevServerOnlyWhenSet() {
    #expect(UINavigation.isApp(URL(string: "http://127.0.0.1:5173/src/main.tsx")!, devURL: dev))
    #expect(!UINavigation.isApp(URL(string: "http://127.0.0.1:8080/")!, devURL: dev))
    #expect(!UINavigation.isApp(URL(string: "https://127.0.0.1:5173/")!, devURL: dev))
  }
}

@Suite struct SelfTestScrubTests {
  @MainActor @Test func dropsVisitorRequestAndTrackingIds() throws {
    let scrubbed = try #require(SelfTest.scrub([
      "responseContext": [
        "visitorData": "v", "responseId": "r",
        "serviceTrackingParams": [["params": [["key": "GetBrowseHomePage_rid", "value": "0x1"], ["key": "logged_in", "value": "0"]]]],
      ],
      "contents": [["trackingParams": "t", "clickTrackingParams": "c", "title": "kept"]],
    ]) as? [String: Any])
    let text = String(decoding: try JSONSerialization.data(withJSONObject: scrubbed), as: UTF8.self)
    for gone in ["visitorData", "responseId", "trackingParams", "0x1"] { #expect(!text.contains(gone)) }
    #expect(text.contains("kept"))
    #expect(InnerTube.loggedIn(scrubbed) == "0")
  }
}
