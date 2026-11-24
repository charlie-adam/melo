// JS -> Swift requests arrive through a WKScriptMessageHandlerWithReply, so each postMessage in the UI gets a promise
// back. Swift -> JS events go through window.melo.emit. The message shapes live in Protocol.swift.
import Foundation
import OSLog
import WebKit

let log = Logger(subsystem: "com.charlieadam.melo", category: "bridge")

@MainActor
final class Bridge: NSObject, WKScriptMessageHandlerWithReply {
  static let name = "melo"
  weak var webView: WKWebView?
  /// The Vite dev server, when the UI loads from it instead of melo://app/.
  var devURL: URL?
  /// The menu bar and mini player pages, which get the same events as the main UI.
  private let pages = NSHashTable<WKWebView>.weakObjects()

  func attach(_ page: WKWebView) { pages.add(page) }

  struct Refused: Error, CustomStringConvertible {
    let description: String
  }

  /// What the menu bar and mini player pages may ask for: the current and next entry, transport, settings, the
  /// window, and the like button (`next` for its state, `like/*` to change it). Everything else is the main window's.
  nonisolated static func satelliteMay(_ request: Request) -> Bool {
    switch request {
    case .queueGet, .queueNext, .queuePrevious, .playerToggle, .playerGet, .settingsGet, .settingsSet, .appShowWindow,
      .appQuit, .libraryBroadcast:
      true
    case .apiCall(let params): ["next", "like/like", "like/dislike", "like/removelike"].contains(params.endpoint)
    default: false
    }
  }

  /// Only the main frame of a page on melo://app/ (or the dev server) may use the bridge.
  nonisolated static func isAppFrame(_ url: URL?, isMainFrame: Bool, devURL: URL?) -> Bool {
    guard isMainFrame, let url else { return false }
    return UINavigation.isApp(url, devURL: devURL)
  }

  /// Decodes a message body, runs it, and returns the result as a JSON object for WebKit to hand back to JS.
  /// `satellite` limits the request to what `satelliteMay` allows.
  static func handle(_ body: Any, satellite: Bool = false) async throws -> Any {
    let request = try JSONDecoder().decode(Request.self, from: JSONSerialization.data(withJSONObject: body))
    guard !satellite || satelliteMay(request) else { throw Refused(description: "Not allowed from this page") }
    switch request {
    case .ping(let params):
      log.debug("ping sentAt=\(params.sentAt)")
      return try json(PingResult(receivedAt: Date().timeIntervalSince1970 * 1000))
    // Sign-in and InnerTube.
    case .authStatus: return try json(await Auth.shared.status())
    case .authSignIn: return try json(await Auth.shared.signIn())
    case .authSignOut:
      let status = await Auth.shared.signOut()
      await Queue.shared?.clear()  // The next account starts with an empty queue.
      return try json(status)
    case .apiCall(let params):
      let body = try JSONSerialization.jsonObject(with: JSONEncoder().encode(params.body)) as! [String: Any]
      do {
        return ["ok": true, "json": try await InnerTubeClient.shared.call(params.endpoint, body: body)]
      } catch let error as APIError {
        return ["ok": false, "error": try json(error)]
      }
    // Player
    case .playerPlay: try await Player.shared?.play()
    case .playerPause: try await Player.shared?.pause()
    case .playerToggle: try await Player.shared?.toggle()
    case .playerSeek(let params): try await Player.shared?.seek(params.seconds)
    case .playerSetVolume(let params): try await Player.shared?.setVolume(params.volume)
    case .playerLoad(let params): await Player.shared?.load(params)
    case .playerGet: return try json(Player.shared?.state ?? .idle)
    // Queue
    case .queueGet:
      guard let queue = Queue.shared else { throw QueueError(description: "No queue") }
      return try json(queue.snapshot())
    case .queueSet(let params):
      try await Queue.shared?.set(params.items, at: params.index, source: params.source, continuation: params.continuation)
    case .queuePlayNext(let params): await Queue.shared?.playNext(params.item)
    case .queueAdd(let params): await Queue.shared?.add(params.item)
    case .queueRemove(let params): try await Queue.shared?.remove(at: params.index)
    case .queueJump(let params): try await Queue.shared?.jump(to: params.index)
    case .queueMove(let params): try Queue.shared?.move(from: params.from, to: params.to)
    case .queueNext: await Queue.shared?.next()
    case .queuePrevious: await Queue.shared?.previous()
    case .queueSetShuffle(let params): Queue.shared?.setShuffle(params.enabled)
    case .queueSetAutoplay(let params): Queue.shared?.setAutoplay(params.enabled)
    case .queueSetRepeat(let params): Queue.shared?.setRepeat(params.mode)
    case .queueAppend(let params):
      await Queue.shared?.append(params.items, continuation: params.continuation, after: params.after)
    case .settingsGet:
      guard let settings = SettingsStore.shared else { throw QueueError(description: "No settings") }
      return try json(settings.value)
    case .settingsSet(let patch):
      guard let settings = SettingsStore.shared else { throw QueueError(description: "No settings") }
      return try json(settings.apply(patch))
    case .lyricsLrclib(let params): return try json(await Lrclib.search(params))
    case .appShowWindow: (NSApp.delegate as? AppDelegate)?.showMainWindow()
    case .appQuit: NSApp.terminate(nil)
    case .appCopyLink(let params):
      NSPasteboard.general.clearContents()
      NSPasteboard.general.setString(params.url, forType: .string)
    case .libraryBroadcast(let change):
      // Every page applies it, the sender included, so the main window and the satellites agree.
      if let bridge = (NSApp.delegate as? AppDelegate)?.bridge { Task { await bridge.emit(.libraryChanged(change)) } }
    case .navState(let state): (NSApp.delegate as? AppDelegate)?.navigation.update(state)
    }
    return NSNull()  // Player and queue requests resolve with null.
  }

  static func json(_ value: some Encodable) throws -> Any {
    try JSONSerialization.jsonObject(with: JSONEncoder().encode(value))
  }

  /// The size of a JSON value once encoded, so logs can say how big a message was without showing it.
  nonisolated static func size(of value: Any) -> Int {
    guard JSONSerialization.isValidJSONObject(value), let data = try? JSONSerialization.data(withJSONObject: value)
    else { return 0 }
    return data.count
  }

  // Every request is logged at debug level with its method, page, sizes and time; values never are.
  func userContentController(
    _ controller: WKUserContentController, didReceive message: WKScriptMessage
  ) async -> (Any?, String?) {
    let page = message.webView === webView ? "main" : message.webView.map(pages.contains) == true ? "satellite" : nil
    let bytes = Self.size(of: message.body)
    guard let page, Self.isAppFrame(message.frameInfo.request.url, isMainFrame: message.frameInfo.isMainFrame, devURL: devURL)
    else {
      log.error("Refused a \(bytes)-byte request from a frame outside the app")
      return (nil, "Refused")
    }
    let started = ContinuousClock.now
    do {
      let result = try await Self.handle(message.body, satellite: page == "satellite")
      // The method is only logged once it decoded, so it is one of ours and not page text.
      let method = (message.body as? [String: Any])?["method"] as? String ?? "?"
      let reply = result is NSNull ? 0 : Self.size(of: result)
      log.debug(
        "\(method, privacy: .public) from \(page, privacy: .public): \(bytes) bytes in, \(reply) out, \(ContinuousClock.now - started, privacy: .public)"
      )
      return (result, nil)
    } catch {
      log.error("Rejected a \(bytes)-byte request from \(page, privacy: .public): \(error)")
      return (nil, "\(error)")
    }
  }

  func emit(_ event: Event) async {
    for page in pages.allObjects { await emit(event, to: page) }
    guard let webView else { return }
    await emit(event, to: webView)
  }

  private func emit(_ event: Event, to webView: WKWebView) async {
    do {
      let json = try Self.json(event)
      let listeners = try await webView.callAsyncJavaScript(
        "return window.melo?.emit(event) ?? 0", arguments: ["event": json], contentWorld: .page)
      let name = (json as? [String: Any])?["name"] as? String ?? "?"
      let count = String(describing: listeners ?? 0)
      log.debug(
        "\(name, privacy: .public) event, \(Self.size(of: json)) bytes, delivered to \(count, privacy: .public) listener(s)")
    } catch {
      log.error("Emit failed: \(error)")
    }
  }
}
