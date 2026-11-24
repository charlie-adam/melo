// The menu bar item and the mini player. Each is a small panel holding a UI web view on the same React bundle, opened
// at melo://app/#menubar or #mini, so both share the design tokens, artwork handling and bridge with the main
// window and render in the Vite fixture preview; native AppKit views would have to restyle all of that by hand.
import AppKit
import WebKit

/// Builds UI web views that match the main window's: same data store, scheme handler, navigation rules and bridge.
@MainActor
struct UIPages {
  let bridge: Bridge
  let dataStore: WKWebsiteDataStore
  let root: URL
  let devURL: URL?
  let navigation: UINavigation

  func make(_ page: String, frame: NSRect) -> WKWebView {
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = dataStore
    configuration.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: Bridge.name)
        configuration.setURLSchemeHandler(AppSchemeHandler(root: root), forURLScheme: AppSchemeHandler.scheme)
    let webView = WKWebView(frame: frame, configuration: configuration)
    webView.isInspectable = true
    // The page draws its own rounded card; the panel around it is clear.
    webView.setValue(false, forKey: "drawsBackground")
    webView.navigationDelegate = navigation
    webView.uiDelegate = navigation
    bridge.attach(webView)
    var components = URLComponents(url: devURL ?? AppSchemeHandler.startURL, resolvingAgainstBaseURL: false)!
    components.fragment = page
    webView.load(URLRequest(url: components.url!))
    return webView
  }
}

/// A borderless panel that can take key focus, so the page gets keyboard shortcuts.
final class PagePanel: NSPanel {
  override var canBecomeKey: Bool { true }
}

@MainActor private func makePagePanel(size: NSSize, radius: CGFloat, content: WKWebView) -> PagePanel {
  let panel = PagePanel(
    contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered,
    defer: false)
  panel.isOpaque = false
  panel.backgroundColor = .clear
  panel.hasShadow = true
  panel.isReleasedWhenClosed = false
  panel.hidesOnDeactivate = false
  let container = NSView(frame: NSRect(origin: .zero, size: size))
  container.wantsLayer = true
  container.layer?.cornerRadius = radius
  container.layer?.masksToBounds = true
  content.frame = container.bounds
  content.autoresizingMask = [.width, .height]
  container.addSubview(content)
  panel.contentView = container
  return panel
}

/// The status item and its now-playing panel (MenuBar mockup).
@MainActor
final class MenuBarItem: NSObject, NSWindowDelegate {
  /// The page's card is 320pt wide; its height follows the layout in ui/src/satellite/Satellite.css.
  static let size = NSSize(width: 320, height: 267)
  private let item: NSStatusItem
  private let panel: PagePanel

  init(pages: UIPages) {
    item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    panel = makePagePanel(size: Self.size, radius: 12, content: pages.make("menubar", frame: NSRect(origin: .zero, size: Self.size)))
    super.init()
    panel.level = .popUpMenu
    panel.delegate = self
    item.button?.image = Self.icon()
    item.button?.setAccessibilityLabel("Melo")
    item.button?.target = self
    item.button?.action = #selector(toggle)
  }

  func remove() {
    panel.close()
    NSStatusBar.system.removeStatusItem(item)
  }

  @objc private func toggle() {
    if panel.isVisible { return panel.orderOut(nil) }
    guard let button = item.button, let window = button.window else { return }
    let anchor = window.convertToScreen(button.convert(button.bounds, to: nil))
    let screen = window.screen?.visibleFrame ?? anchor
    var x = anchor.midX - Self.size.width / 2
    x = min(max(x, screen.minX + 8), screen.maxX - Self.size.width - 8)
    panel.setFrameOrigin(NSPoint(x: x, y: anchor.minY - Self.size.height - 6))
    panel.makeKeyAndOrderFront(nil)
  }

  func hide() { panel.orderOut(nil) }

  // Clicking anywhere else closes it, like a menu.
  func windowDidResignKey(_ notification: Notification) { panel.orderOut(nil) }

  /// A record: a filled circle with a hole, drawn as a template so it follows the menu bar's colour.
  static func icon() -> NSImage {
    let image = NSImage(size: NSSize(width: 16, height: 16), flipped: false) { rect in
      let disc = NSBezierPath(ovalIn: rect.insetBy(dx: 1.5, dy: 1.5))
      disc.append(NSBezierPath(ovalIn: rect.insetBy(dx: 5.8, dy: 5.8)).reversed)
      NSColor.black.setFill()
      disc.fill()
      return true
    }
    image.isTemplate = true
    return image
  }
}

/// The floating mini player (MenuBar mockup, lower left). Dragging the artwork moves it.
@MainActor
final class MiniPlayer {
  static let size = NSSize(width: 380, height: 120)
  private let panel: PagePanel

  init(pages: UIPages) {
    panel = makePagePanel(size: Self.size, radius: 14, content: pages.make("mini", frame: NSRect(origin: .zero, size: Self.size)))
    panel.level = .floating
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
    panel.isMovableByWindowBackground = true
    // The artwork square is the drag handle: a plain view over it lets the window background move the panel.
    let handle = DragHandle(frame: NSRect(x: 0, y: 0, width: Self.size.height, height: Self.size.height))
    panel.contentView?.addSubview(handle)
    panel.setFrameAutosaveName("MeloMiniPlayer")
    if !panel.setFrameUsingName("MeloMiniPlayer"), let screen = NSScreen.main?.visibleFrame {
      panel.setFrameOrigin(NSPoint(x: screen.maxX - Self.size.width - 24, y: screen.minY + 24))
    }
  }

  func show() { panel.orderFrontRegardless() }
  func close() { panel.close() }

  private final class DragHandle: NSView {
    override var mouseDownCanMoveWindow: Bool { true }
  }
}

/// Settings that the shell acts on: theme, the menu bar item, the mini player and media keys.
@MainActor
final class Satellites {
  static var shared: Satellites?
  let pages: UIPages
  let nowPlaying: NowPlaying
  private var menuBar: MenuBarItem?
  private var mini: MiniPlayer?

  init(pages: UIPages, nowPlaying: NowPlaying) {
    self.pages = pages
    self.nowPlaying = nowPlaying
  }

  func apply(_ settings: AppSettings) {
    switch settings.theme {
    case .system: NSApp.appearance = nil
    case .light: NSApp.appearance = NSAppearance(named: .aqua)
    case .dark: NSApp.appearance = NSAppearance(named: .darkAqua)
    }
    nowPlaying.setMediaKeys(settings.mediaKeys)
    if settings.menuBarItem, menuBar == nil { menuBar = MenuBarItem(pages: pages) }
    if !settings.menuBarItem { menuBar?.remove(); menuBar = nil }
    if settings.miniPlayer {
      if mini == nil { mini = MiniPlayer(pages: pages) }
      mini?.show()
    } else {
      mini?.close()
      mini = nil
    }
  }

  func hideMenu() { menuBar?.hide() }
}

extension AppDelegate {
  /// Loads the settings, applies them now and on every change, and tells every page.
  func startMedia(mainView: WKWebView, root: URL, devURL: URL?) {
    let settings = SettingsStore()
    SettingsStore.shared = settings
    let pages = UIPages(
      bridge: bridge, dataStore: mainView.configuration.websiteDataStore, root: root, devURL: devURL,
      navigation: uiNavigation)
    let satellites = Satellites(pages: pages, nowPlaying: nowPlaying)
    Satellites.shared = satellites
    settings.onChange = { [bridge] value in
      satellites.apply(value)
      Task { await bridge.emit(.settingsChanged(value)) }
    }
    satellites.apply(settings.value)
  }

  func showMainWindow() {
    Satellites.shared?.hideMenu()
    window.makeKeyAndOrderFront(nil)
    NSApp.activate()
  }

  @objc func toggleMiniPlayer(_ sender: Any?) {
    guard let settings = SettingsStore.shared else { return }
    settings.apply(SettingsPatch(miniPlayer: !settings.value.miniPlayer))
  }
}

extension AppDelegate {
  /// Window > Mini Player, Cmd-Shift-M.
  func miniPlayerMenuItem() -> NSMenuItem {
    let item = NSMenuItem(title: "Mini Player", action: #selector(toggleMiniPlayer(_:)), keyEquivalent: "M")
    item.keyEquivalentModifierMask = [.command, .shift]
    item.target = self
    return item
  }
}
