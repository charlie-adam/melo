// Sign-in: a login window on WKWebsiteDataStore.default(), completion detected from the cookie jar, a Keychain backup
// of the auth cookies, and sign out. Cookie values stay in Swift and are never logged or sent to the UI.
import AppKit
import OSLog
import Security
import WebKit

private let authLog = Logger(subsystem: "com.charlieadam.melo", category: "auth")

@MainActor
final class Auth: NSObject, WKHTTPCookieStoreObserver, WKNavigationDelegate, WKUIDelegate, NSWindowDelegate {
  static let shared = Auth()

  static let loginURL = URL(
    string: "https://accounts.google.com/ServiceLogin?service=youtube&uilel=3&passive=true&continue=https%3A%2F%2Fwww.youtube.com%2Fsignin%3Faction_handle_signin%3Dtrue%26app%3Ddesktop%26hl%3Den%26next%3Dhttps%253A%252F%252Fmusic.youtube.com%252F"
  )!
  // A Safari UA keeps Google from showing "browser not supported".
  static let webViewUserAgent =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
  /// The cookies worth backing up, from Kaset's allowlist.
  nonisolated static let backupNames: Set<String> = [
    "SAPISID", "__Secure-3PAPISID", "__Secure-1PAPISID", "SID", "HSID", "SSID", "APISID", "LOGIN_INFO", "SIDCC",
    "__Secure-1PSID", "__Secure-3PSID", "__Secure-1PSIDCC", "__Secure-3PSIDCC", "__Secure-1PSIDTS", "__Secure-3PSIDTS",
  ]
  /// Cookies a fresh sign-in replaces, so a change in them means the login went through.
  nonisolated static let loginNames = ["SID", "__Secure-3PSID", "SAPISID", "__Secure-3PAPISID"]

  // WebKit has no passkey support without Apple's browser entitlement, and Google dead-ends on the failure instead of
  // offering the password, so hide passkeys from every frame before Google's feature detection runs.
  static let passkeySuppression = """
    (function () {
      try {
        delete window.PublicKeyCredential;
        Object.defineProperty(window, "PublicKeyCredential", { value: undefined, writable: false, configurable: false });
      } catch (e) {}
      try {
        var proto = Object.getPrototypeOf(navigator.credentials);
        var wrap = function (original) {
          return function (options) {
            if (options && options.publicKey) {
              return Promise.reject(new DOMException("Passkeys are not available in this app.", "NotAllowedError"));
            }
            return original.apply(this, arguments);
          };
        };
        proto.get = wrap(proto.get);
        proto.create = wrap(proto.create);
      } catch (e) {}
    })();
    """

  var store: WKHTTPCookieStore { WKWebsiteDataStore.default().httpCookieStore }
  var onChange: ((AuthStatus) -> Void)?
  /// Set by a 401 or 403 on a signed-in call, cleared by the next sign-in. Nothing is deleted when it is set.
  private(set) var expired = false
  private var lastStatus: AuthStatus?
  private var restoring: Task<Void, Never>?
  private var backup: Task<Void, Never>?
  private var login: (window: NSWindow, baseline: [String?])?
  private var waiters: [CheckedContinuation<AuthStatus, Never>] = []

  // MARK: Cookie helpers, pure so tests can reach them

  nonisolated static func isYouTube(_ cookie: HTTPCookie) -> Bool {
    let domain = cookie.domain.lowercased().trimmingPrefix(".")
    return domain == "youtube.com" || domain == "music.youtube.com"
  }

  nonisolated static func isBackedUp(_ cookie: HTTPCookie, now: Date) -> Bool {
    let domain = cookie.domain.lowercased()
    let ours = ["youtube.com", "google.com"].contains { domain.trimmingPrefix(".") == $0 || domain.hasSuffix(".\($0)") }
    return ours && backupNames.contains(cookie.name) && (cookie.expiresDate.map { $0 > now } ?? true)
  }

  /// The Cookie header and SAPISID for InnerTube, or nil when signed out. `__Secure-3PAPISID` wins over `SAPISID`,
  /// and an expired 3P cookie means expired even if `SAPISID` is still there.
  nonisolated static func credentials(from cookies: [HTTPCookie], now: Date = Date()) -> InnerTube.Credentials? {
    let youtube = cookies.filter(isYouTube)
    guard let auth = youtube.first(where: { $0.name == "__Secure-3PAPISID" }) ?? youtube.first(where: { $0.name == "SAPISID" }),
      auth.expiresDate.map({ $0 > now }) ?? true,
      let header = HTTPCookie.requestHeaderFields(with: youtube)["Cookie"]
    else { return nil }
    return InnerTube.Credentials(cookieHeader: header, sapisid: auth.value)
  }

  nonisolated static func loginSnapshot(_ cookies: [HTTPCookie]) -> [String?] {
    loginNames.map { name in cookies.first { isYouTube($0) && $0.name == name }?.value }
  }

  nonisolated static func archive(_ cookies: [HTTPCookie]) -> Data? {
    let list: [[String: Any]] = cookies.compactMap { cookie in
      cookie.properties.map { properties in
        Dictionary(uniqueKeysWithValues: properties.compactMap { key, value in
          value is String || value is Date || value is NSNumber ? (key.rawValue, value) : nil
        })
      }
    }
    return try? PropertyListSerialization.data(fromPropertyList: list, format: .binary, options: 0)
  }

  nonisolated static func unarchive(_ data: Data) -> [HTTPCookie] {
    guard let list = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [[String: Any]] else {
      return []
    }
    return list.compactMap { properties in
      HTTPCookie(properties: Dictionary(uniqueKeysWithValues: properties.map { (HTTPCookiePropertyKey($0.key), $0.value) }))
    }
  }

  // MARK: State

  /// Starts watching the cookie jar and restores the Keychain backup when WebKit has lost the login.
  func start() {
    store.add(self)
    restoring = Task { await restore() }
  }

  private func restore() async {
    guard Self.credentials(from: await store.allCookies()) == nil else { return }
    guard let data = Keychain.read() else { return }
    let cookies = Self.unarchive(data)
    for cookie in cookies { await store.setCookie(cookie) }
    authLog.info("Restored \(cookies.count) cookie(s) from the Keychain")
  }

  func credentials() async -> InnerTube.Credentials? {
    await restoring?.value
    return Self.credentials(from: await store.allCookies())
  }

  func status() async -> AuthStatus {
    AuthStatus(signedIn: await credentials() != nil, expired: expired)
  }

  func markExpired() {
    guard !expired else { return }
    authLog.error("Signed-in request was refused; keeping stored cookies and asking the UI to re-auth")
    expired = true
    Task { await publish() }
  }

  /// Emits `auth.changed` when the status differs from the last one sent.
  private func publish() async {
    let status = await status()
    guard status != lastStatus else { return }
    lastStatus = status
    authLog.info("signedIn=\(status.signedIn) expired=\(status.expired)")
    onChange?(status)
  }

  nonisolated func cookiesDidChange(in cookieStore: WKHTTPCookieStore) {
    Task { @MainActor in await self.cookiesChanged() }
  }

  private func cookiesChanged() async {
    let cookies = await store.allCookies()
    if Self.credentials(from: cookies) != nil {
      // Debounced: SIDCC rotates often while the player is loaded.
      backup?.cancel()
      backup = Task {
        try? await Task.sleep(for: .seconds(5))
        if !Task.isCancelled { await saveBackup() }
      }
      if let login, Self.loginSnapshot(cookies) != login.baseline { await finishSignIn() }
    }
    await publish()
  }

  private func saveBackup() async {
    let now = Date()
    let cookies = await store.allCookies().filter { Self.isBackedUp($0, now: now) }
    guard Self.credentials(from: cookies) != nil, let data = Self.archive(cookies) else { return }
    Keychain.write(data)
  }

  // MARK: Sign in and out

  enum LoginNavigation: Equatable { case allow, browser, block }

  /// The login window's main frame stays on https Google and YouTube hosts, which cover sign-in, consent and the
  /// redirect back to YouTube Music. Other web links (help, privacy) open in the default browser; anything else is
  /// blocked. Subframes are left to Google.
  nonisolated static func loginNavigation(to url: URL?, isMainFrame: Bool) -> LoginNavigation {
    guard isMainFrame else { return .allow }
    guard let url, let host = url.host?.lowercased() else { return .block }
    let trusted = ["google.com", "youtube.com"].contains { host == $0 || host.hasSuffix(".\($0)") }
    if url.scheme == "https", trusted { return .allow }
    return url.scheme == "https" || url.scheme == "http" ? .browser : .block
  }

  func webView(
    _ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
    decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void
  ) {
    let url = action.request.url
    let decision = Self.loginNavigation(to: url, isMainFrame: action.targetFrame?.isMainFrame == true)
    if decision != .allow { authLog.warning("Login window left \(url?.host ?? "-", privacy: .public)") }
    if decision == .browser, let url { NSWorkspace.shared.open(url) }
    decisionHandler(decision == .allow ? .allow : .cancel)
  }

  // Links that open a new window (help pages, mostly) go to the default browser.
  func webView(
    _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction,
    windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    if let url = action.request.url, url.scheme == "https" || url.scheme == "http" { NSWorkspace.shared.open(url) }
    return nil
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    authLog.error("Login content process terminated; reloading")
    webView.load(URLRequest(url: Self.loginURL))
  }

  /// Opens the login window, or focuses it if open, and resolves when sign-in completes or the window closes.
  func signIn() async -> AuthStatus {
    if let login {
      login.window.makeKeyAndOrderFront(nil)
    } else {
      let configuration = WKWebViewConfiguration()
      configuration.websiteDataStore = .default()
      configuration.userContentController.addUserScript(
        WKUserScript(source: Self.passkeySuppression, injectionTime: .atDocumentStart, forMainFrameOnly: false))
      let webView = WKWebView(frame: .zero, configuration: configuration)
      webView.customUserAgent = Self.webViewUserAgent
      webView.navigationDelegate = self
      webView.uiDelegate = self
      let window = NSWindow(
        contentRect: NSRect(x: 0, y: 0, width: 520, height: 720), styleMask: [.titled, .closable, .resizable],
        backing: .buffered, defer: false)
      window.title = "Sign in to YouTube Music"
      window.isReleasedWhenClosed = false
      window.contentView = webView
      window.delegate = self
      login = (window, Self.loginSnapshot(await store.allCookies()))
      webView.load(URLRequest(url: Self.loginURL))
      window.center()
      window.makeKeyAndOrderFront(nil)
      authLog.info("Login window opened")
    }
    return await withCheckedContinuation { waiters.append($0) }
  }

  // Signing in when Google already has a session redirects straight to music.youtube.com without changing cookies.
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    guard webView.url?.host == "music.youtube.com" else { return }
    Task {
      if Self.credentials(from: await store.allCookies()) != nil { await finishSignIn() }
    }
  }

  private func finishSignIn() async {
    guard login != nil else { return }
    // Let the rest of the login cookies land before backing them up.
    try? await Task.sleep(for: .milliseconds(500))
    guard let window = login?.window else { return }
    login = nil
    expired = false
    await saveBackup()
    authLog.info("Sign-in complete")
    window.close()
    await resolveWaiters()
  }

  func windowWillClose(_ notification: Notification) {
    guard login != nil else { return }
    login = nil
    authLog.info("Login window closed without signing in")
    Task { await resolveWaiters() }
  }

  private func resolveWaiters() async {
    await publish()
    let status = await status()
    waiters.forEach { $0.resume(returning: status) }
    waiters = []
  }

  /// Clears the Keychain backup and every YouTube and Google cookie in WebKit.
  func signOut() async -> AuthStatus {
    backup?.cancel()
    Keychain.delete()
    for cookie in await store.allCookies() {
      let domain = cookie.domain.lowercased()
      if domain.hasSuffix("youtube.com") || domain.hasSuffix("google.com") { await store.deleteCookie(cookie) }
    }
    expired = false
    authLog.info("Signed out")
    await publish()
    return await status()
  }
}

/// One generic-password item holding the cookie archive. It is the backup that survives WebKit losing its jar.
enum Keychain {
  static var query: [String: Any] {
    [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: "com.charlieadam.melo.cookies",
    kSecAttrAccount as String: "youtube",
    ]
  }

  static func read() -> Data? {
    var result: AnyObject?
    var search = query
    search[kSecReturnData as String] = true
    let status = SecItemCopyMatching(search as CFDictionary, &result)
    if status != errSecSuccess && status != errSecItemNotFound { authLog.error("Keychain read failed: \(status)") }
    return result as? Data
  }

  static func write(_ data: Data) {
    var status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
    if status == errSecItemNotFound {
      var item = query
      item[kSecValueData as String] = data
      item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlocked
      // Stays on this Mac: never synced through iCloud Keychain.
      item[kSecAttrSynchronizable as String] = false
      status = SecItemAdd(item as CFDictionary, nil)
    }
    if status != errSecSuccess { authLog.error("Keychain write failed: \(status)") }
  }

  static func delete() {
    let status = SecItemDelete(query as CFDictionary)
    if status != errSecSuccess && status != errSecItemNotFound { authLog.error("Keychain delete failed: \(status)") }
  }
}
