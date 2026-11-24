// Melo's settings, kept in UserDefaults on the Swift side so every web view (main window, menu bar, mini player) and
// the shell read the same values. Autoplay is not here: it belongs to the queue, which saves it with queue.json.
import Foundation

/// The `settings.get` and `settings.set` result, and the `settings.changed` payload.
struct AppSettings: Codable, Equatable {
  enum Theme: String, Codable { case system, light, dark }
  var theme: Theme = .system
  var lyricsFromLrclib = true
  var menuBarItem = true
  var miniPlayer = false
  var mediaKeys = true
}

/// `settings.set` params: only the fields to change.
struct SettingsPatch: Decodable, Equatable {
  var theme: AppSettings.Theme?
  var lyricsFromLrclib: Bool?
  var menuBarItem: Bool?
  var miniPlayer: Bool?
  var mediaKeys: Bool?

  func applied(to settings: AppSettings) -> AppSettings {
    var next = settings
    if let theme { next.theme = theme }
    if let lyricsFromLrclib { next.lyricsFromLrclib = lyricsFromLrclib }
    if let menuBarItem { next.menuBarItem = menuBarItem }
    if let miniPlayer { next.miniPlayer = miniPlayer }
    if let mediaKeys { next.mediaKeys = mediaKeys }
    return next
  }
}

/// Reads and writes `AppSettings`, one UserDefaults key per field, and reports every change.
@MainActor
final class SettingsStore {
  static var shared: SettingsStore?
  private let defaults: UserDefaults
  private(set) var value: AppSettings
  /// Called after every change, with the new settings.
  var onChange: ((AppSettings) -> Void)?

  private enum Key {
    static let theme = "settings.theme"
    static let lyricsFromLrclib = "settings.lyricsFromLrclib"
    static let menuBarItem = "settings.menuBarItem"
    static let miniPlayer = "settings.miniPlayer"
    static let mediaKeys = "settings.mediaKeys"
  }

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
    var value = AppSettings()
    if let raw = defaults.string(forKey: Key.theme), let theme = AppSettings.Theme(rawValue: raw) { value.theme = theme }
    func bool(_ key: String, _ fallback: Bool) -> Bool { defaults.object(forKey: key) as? Bool ?? fallback }
    value.lyricsFromLrclib = bool(Key.lyricsFromLrclib, value.lyricsFromLrclib)
    value.menuBarItem = bool(Key.menuBarItem, value.menuBarItem)
    value.miniPlayer = bool(Key.miniPlayer, value.miniPlayer)
    value.mediaKeys = bool(Key.mediaKeys, value.mediaKeys)
    self.value = value
  }

  @discardableResult
  func apply(_ patch: SettingsPatch) -> AppSettings {
    let next = patch.applied(to: value)
    guard next != value else { return value }
    value = next
    defaults.set(next.theme.rawValue, forKey: Key.theme)
    defaults.set(next.lyricsFromLrclib, forKey: Key.lyricsFromLrclib)
    defaults.set(next.menuBarItem, forKey: Key.menuBarItem)
    defaults.set(next.miniPlayer, forKey: Key.miniPlayer)
    defaults.set(next.mediaKeys, forKey: Key.mediaKeys)
    onChange?(next)
    return next
  }
}
