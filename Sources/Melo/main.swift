// Melo's window: one WKWebView showing the React UI, from melo://app/ or, when MELO_DEV_URL is set, from the
// Vite dev server. Built into Melo.app by scripts/build.sh.
import AppKit
import WebKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
  var window: NSWindow!
  let bridge = Bridge()
  var uiNavigation: UINavigation!
  var nowPlaying: NowPlaying!  // Queue

  func applicationDidFinishLaunching(_ notification: Notification) {
    // Restore the login from the Keychain, push auth changes to the UI, and the live self-test.
    Auth.shared.start()
    if ProcessInfo.processInfo.environment["MELO_SELFTEST"] == "1" {
      Task { exit(await SelfTest.run()) }
      return
    }
    Auth.shared.onChange = { [bridge] status in Task { await bridge.emit(.authChanged(status)) } }

    // Player: the hidden player on the signed-in default store. Its self-test plays anonymously in a throwaway store,
    // with the window never shown.
    let playerSelfTest = ProcessInfo.processInfo.environment["MELO_PLAYER_SELFTEST"]
    let queueSelfTest = ProcessInfo.processInfo.environment["MELO_QUEUE_SELFTEST"]
    let selfTest = playerSelfTest != nil || queueSelfTest != nil
    let player = Player(dataStore: selfTest ? .nonPersistent() : .default())
    Player.shared = player
    if !selfTest {
      // The page must be signed in exactly when the app is, or Premium gets ads; the player reloads on a mismatch.
      Auth.shared.onChange = { [bridge] status in
        Task { await bridge.emit(.authChanged(status)) }
        player.signedIn = status.signedIn
      }
      Task { player.signedIn = await Auth.shared.status().signedIn }
    } else if !player.muteForSelfTest() {
      print("player self-test: could not hard-mute the player page, refusing to play anything")
      exit(1)
    }

    // Queue: Melo's queue drives the player, and Now Playing follows both. The queue self-test saves to a temporary
    // file, never the real one.
    let queue =
      queueSelfTest == nil
      ? Queue(player: player, store: .standard)
      : Queue(player: QueueSelfTest.CountingPlayer(player), store: QueueSelfTest.store)
    Queue.shared = queue
    let nowPlaying = NowPlaying(queue: queue, player: player)
    self.nowPlaying = nowPlaying
    nowPlaying.registerCommands()
    player.onState = { [bridge] state in
      Task { await bridge.emit(.playerState(state)) }
      Task { await queue.handle(state) }
      nowPlaying.update()
    }
    player.onRemote = { remote in nowPlaying.perform(remote) }
    queue.onEvent = { [bridge] event in
      Task { await bridge.emit(event) }
      nowPlaying.update()
    }

    buildMenu()

    let configuration = WKWebViewConfiguration()
    // The UI gets its own throwaway data store, so YouTube cookies in the default store can never reach it.
    configuration.websiteDataStore = .nonPersistent()
    configuration.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: Bridge.name)
    let ui = Bundle.main.resourceURL!.appending(path: "ui")
    configuration.setURLSchemeHandler(AppSchemeHandler(root: ui), forURLScheme: AppSchemeHandler.scheme)
    let webView = WKWebView(frame: .zero, configuration: configuration)
    webView.isInspectable = true
    bridge.webView = webView

    let dev = ProcessInfo.processInfo.environment["MELO_DEV_URL"].flatMap(URL.init(string:))
    bridge.devURL = dev
    // The UI stays on its own origin; other links open in the default browser.
    uiNavigation = UINavigation(devURL: dev)
    webView.navigationDelegate = uiNavigation
    webView.uiDelegate = uiNavigation
    webView.load(URLRequest(url: dev ?? AppSchemeHandler.startURL))

    window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1280, height: 800),
      styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
      backing: .buffered, defer: false)
    window.title = "Melo"
    window.titleVisibility = .hidden
    window.titlebarAppearsTransparent = true
    // An empty unified toolbar makes the title bar 52pt tall, which centres the traffic lights on the UI's top bar
    // and lets that strip drag the window.
    window.toolbar = NSToolbar(identifier: "Melo")
    window.toolbarStyle = .unified
    window.minSize = NSSize(width: 1000, height: 640)
    // Player: WebKit may suspend media outside a view hierarchy, so the player sits in the window at 1x1, invisible.
    let content = NSView(frame: NSRect(x: 0, y: 0, width: 1280, height: 800))
    webView.frame = content.bounds
    webView.autoresizingMask = [.width, .height]
    content.addSubview(webView)
    content.addSubview(player.webView)
    window.contentView = content
    window.delegate = self
    window.center()
    window.setFrameAutosaveName("Melo")
    if let playerSelfTest {
      let ids = playerSelfTest.split(separator: ",").map(String.init)
      Task { exit(await PlayerSelfTest.run(player, ui: webView, videoIds: ids)) }
      return
    }
    if let queueSelfTest {
      let ids = queueSelfTest == "1" ? QueueSelfTest.defaultIds : queueSelfTest.split(separator: ",").map(String.init)
      Task { exit(await QueueSelfTest.run(queue, player: player, ui: webView, videoIds: ids)) }
      return
    }
    startMedia(mainView: webView, root: ui, devURL: dev)  // Settings, menu bar item, mini player.
    queue.restore()
    window.makeKeyAndOrderFront(nil)
    NSApp.activate()
  }

  // Queue: save the position on the way out.
  func applicationWillTerminate(_ notification: Notification) {
    Queue.shared?.save()
  }

  // Player: closing the window only hides it, so playback carries on; the Dock icon brings it back.
  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

  func windowShouldClose(_ sender: NSWindow) -> Bool {
    sender.orderOut(nil)
    return false
  }

  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
    window.makeKeyAndOrderFront(nil)
    return false
  }

  func buildMenu() {
    let main = NSMenu()
    func submenu(_ title: String, _ items: [NSMenuItem]) {
      let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
      item.submenu = NSMenu(title: title)
      items.forEach { item.submenu!.addItem($0) }
      main.addItem(item)
    }
    submenu("Melo", [
      NSMenuItem(title: "Hide Melo", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h"),
      NSMenuItem(title: "Quit Melo", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"),
    ])
    submenu("Window", [
      NSMenuItem(title: "Minimise", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m"),
      NSMenuItem(title: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w"),
      miniPlayerMenuItem(),
    ])
    NSApp.mainMenu = main
  }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
