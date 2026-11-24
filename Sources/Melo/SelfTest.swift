// MELO_SELFTEST=1: checks InnerTube against the live service, prints one line per check, and quits.
// Anonymous home and search always run; with MELO_SELFTEST_FIXTURES=<dir> their responses are saved there,
// scrubbed of visitor and request ids. It prints statuses and sizes only, never account details.
// When signed in, it also checks a signed-in home (logged_in=1) and that a corrupted SAPISIDHASH
// gets an auth failure: a 401 or 403, or a 200 served signed out (logged_in=0).
import Foundation

@MainActor
enum SelfTest {
  static func run() async -> Int32 {
    let client = InnerTubeClient.shared
    let fixtures = ProcessInfo.processInfo.environment["MELO_SELFTEST_FIXTURES"].map(URL.init(fileURLWithPath:))
    var failures = 0
    func report(_ name: String, _ ok: Bool, _ detail: String) {
      print("selftest \(ok ? "PASS" : "FAIL") \(name): \(detail)")
      if !ok { failures += 1 }
    }

    for (name, endpoint, body) in [
      ("anon-home", "browse", ["browseId": "FEmusic_home"]), ("anon-search", "search", ["query": "radiohead"]),
    ] {
      do {
        let json = try await client.call(endpoint, body: body, signedOut: true)
        let data = try JSONSerialization.data(withJSONObject: scrub(json), options: .withoutEscapingSlashes)
        if let fixtures { try data.write(to: fixtures.appending(path: "\(name).json")) }
        report(name, true, "200, \(data.count) bytes, logged_in=\(InnerTube.loggedIn(json) ?? "?")")
      } catch {
        report(name, false, "\(error)")
      }
    }

    guard let credentials = await Auth.shared.credentials() else {
      print("selftest: signed out, skipping signed-in checks")
      return failures == 0 ? 0 : 1
    }
    do {
      let json = try await client.call("browse", body: ["browseId": "FEmusic_home"])
      report("signed-in-home", InnerTube.loggedIn(json) == "1", "logged_in=\(InnerTube.loggedIn(json) ?? "?")")
    } catch {
      report("signed-in-home", false, "\(error)")
    }
    do {
      let corrupted = InnerTube.Credentials(cookieHeader: credentials.cookieHeader, sapisid: "corrupted")
      let request = try InnerTube.request(
        endpoint: "browse", body: ["browseId": "FEmusic_home"], apiKey: try await client.key(), credentials: corrupted)
      let (data, status) = try await client.send(request)
      let loggedIn = (try? JSONSerialization.jsonObject(with: data)).flatMap(InnerTube.loggedIn)
      let refused = InnerTube.error(forStatus: status)?.kind == .auth
      let signedOut = status == 200 && loggedIn == "0"
      report("corrupted-hash", refused || signedOut, "HTTP \(status), logged_in=\(loggedIn ?? "?")"
        + (refused ? " (refused)" : signedOut ? " (served signed out)" : ""))
    } catch {
      report("corrupted-hash", false, "\(error)")
    }
    let stillStored = Keychain.read() != nil
    report("keychain-kept", stillStored, stillStored ? "backup present" : "no backup")
    return failures == 0 ? 0 : 1
  }

  static let scrubbedKeys: Set<String> = ["visitorData", "responseId", "trackingParams", "clickTrackingParams"]

  /// Drops visitor, request and click-tracking ids, including `*_rid` tracking params, so fixtures can be committed.
  static func scrub(_ json: Any) -> Any {
    if let object = json as? [String: Any] {
      if let key = object["key"] as? String, key.hasSuffix("_rid") { return ["key": key, "value": ""] }
      return object.filter { !scrubbedKeys.contains($0.key) }.mapValues(scrub)
    }
    if let array = json as? [Any] { return array.map(scrub) }
    return json
  }

}
