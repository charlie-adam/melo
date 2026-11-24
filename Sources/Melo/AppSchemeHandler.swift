// Serves the bundled UI build (Contents/Resources/ui) at melo://app/, so production needs no local server.
import UniformTypeIdentifiers
import WebKit

final class AppSchemeHandler: NSObject, WKURLSchemeHandler {
  nonisolated static let scheme = "melo"
  static let startURL = URL(string: "melo://app/")!
  let root: URL

  init(root: URL) {
    self.root = root.standardizedFileURL
  }

  /// The file a request maps to, or nil when it would leave the root.
  static func file(for url: URL, in root: URL) -> URL? {
    let path = url.path.isEmpty || url.path == "/" ? "index.html" : url.path
    let file = root.appending(path: path).standardizedFileURL
    return file.path.hasPrefix(root.path + "/") ? file : nil
  }

  // UTType knows no MIME type for woff2, which is what the bundled Figtree ships as.
  static func mimeType(for file: URL) -> String {
    if file.pathExtension == "woff2" { return "font/woff2" }
    return UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
  }

  func webView(_ webView: WKWebView, start task: any WKURLSchemeTask) {
    let url = task.request.url!
    guard let file = Self.file(for: url, in: root), let data = try? Data(contentsOf: file) else {
      task.didReceive(HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: nil)!)
      task.didFinish()
      return
    }
    let headers = ["Content-Type": Self.mimeType(for: file), "Content-Length": "\(data.count)"]
    task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!)
    task.didReceive(data)
    task.didFinish()
  }

  func webView(_ webView: WKWebView, stop task: any WKURLSchemeTask) {}
}
