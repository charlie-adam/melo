// Keeps the UI web view on melo://app/ (or the Vite dev server in development). Any other link opens in the
// default browser instead, so a remote page never gets the app bridge.
import AppKit
import OSLog
import WebKit

private let uiLog = Logger(subsystem: "com.charlieadam.melo", category: "ui")

@MainActor
final class UINavigation: NSObject, WKNavigationDelegate, WKUIDelegate {
  let devURL: URL?

  init(devURL: URL?) {
    self.devURL = devURL
  }

  nonisolated static func isApp(_ url: URL, devURL: URL?) -> Bool {
    if url.scheme == AppSchemeHandler.scheme && url.host == "app" { return true }
    guard let devURL else { return false }
    return url.scheme == devURL.scheme && url.host == devURL.host && url.port == devURL.port
  }

  func webView(
    _ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
    decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void
  ) {
    guard let url = action.request.url, !Self.isApp(url, devURL: devURL) else { return decisionHandler(.allow) }
    decisionHandler(.cancel)
    open(url)
  }

  // target="_blank" and window.open land here.
  func webView(
    _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction,
    windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    if let url = action.request.url { open(url) }
    return nil
  }

  /// The main window, menu bar and mini player pages all reload in place after a WebContent crash. The UI keeps its
  /// route in the page URL and asks Swift for the queue, player state and settings on load, so nothing is lost.
  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    uiLog.error("UI content process terminated; reloading")
    webView.reload()
  }

  private func open(_ url: URL) {
    guard url.scheme == "https" || url.scheme == "http" else { return }
    NSWorkspace.shared.open(url)
  }
}
