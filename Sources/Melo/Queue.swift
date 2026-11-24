// Melo's own queue. The page never advances on its own (Player stops each track just short of its end), so this
// decides what plays next. It lives in Swift rather than the UI so auto-advance and media keys keep working while the
// window is hidden and the UI's timers are throttled; the UI renders `queue.changed` and sends `queue.*` requests.
// Kaset (MIT) taught what to avoid here: its two-queue sync repeated or stalled tracks (issues #280, #409).
import Foundation
import OSLog

private let queueLog = Logger(subsystem: "com.charlieadam.melo", category: "queue")

struct QueueError: Error, CustomStringConvertible {
  let description: String
}

/// The queue's contents and settings, with no side effects. `entries` is the play order: everything before `index`
/// has played (Previous walks back through it), everything after is up next.
struct QueueState: Codable, Equatable {
  private(set) var entries: [QueueEntry] = []
  /// -1 when the queue is empty.
  private(set) var index = -1
  var source: QueueSource?
  private(set) var shuffle = false
  var repeatMode: RepeatMode = .off
  var autoplay = true
  /// The radio continuation the UI passed with the last `set` or `append`.
  var continuation: String?
  /// Entry ids in their unshuffled order, kept while shuffle is on so turning it off restores the order.
  private(set) var unshuffled: [Int]?
  private var nextId = 0

  var current: QueueEntry? { entries.indices.contains(index) ? entries[index] : nil }
  /// How many entries come after the current one.
  var remaining: Int { entries.count - index - 1 }

  /// Whether a decoded (persisted) state is consistent enough to use.
  var isValid: Bool {
    let ids = Set(entries.map(\.id))
    return (entries.isEmpty ? index == -1 : entries.indices.contains(index)) && ids.count == entries.count
      && (entries.map(\.id).max() ?? -1) < nextId && (unshuffled.map { Set($0) == ids } ?? true)
  }

  private mutating func entry(_ item: QueueItem) -> QueueEntry {
    defer { nextId += 1 }
    return QueueEntry(id: nextId, item: item)
  }

  private func checked(_ i: Int) throws -> Int {
    guard entries.indices.contains(i) else { throw QueueError(description: "Queue index \(i) out of range") }
    return i
  }

  /// Replaces the queue. With shuffle on, the chosen item plays first and the rest are shuffled.
  mutating func replace(with items: [QueueItem], at start: Int, source: QueueSource?, continuation: String?) throws {
    guard items.indices.contains(start) else { throw QueueError(description: "Start index \(start) out of range") }
    entries = items.map { entry($0) }
    index = start
    self.source = source
    self.continuation = continuation
    if shuffle {
      unshuffled = entries.map(\.id)
      let first = entries.remove(at: start)
      entries = [first] + entries.shuffled()
      index = 0
    }
  }

  /// Inserts right after the current entry.
  mutating func playNext(_ item: QueueItem) {
    let new = entry(item)
    if let current, let at = unshuffled?.firstIndex(of: current.id) { unshuffled?.insert(new.id, at: at + 1) }
    else { unshuffled?.append(new.id) }
    entries.insert(new, at: index + 1)
    if index < 0 { index = 0 }
  }

  mutating func add(_ item: QueueItem) {
    let new = entry(item)
    entries.append(new)
    unshuffled?.append(new.id)
    if index < 0 { index = 0 }
  }

  /// Adds radio items to the end, skipping any whose videoId is already queued. Returns how many were added.
  @discardableResult
  mutating func append(_ items: [QueueItem], continuation: String?) -> Int {
    var seen = Set(entries.map(\.item.videoId))
    let fresh = items.filter { seen.insert($0.videoId).inserted }
    for item in fresh { add(item) }
    self.continuation = continuation
    return fresh.count
  }

  /// Returns true when the removed entry was the current one; the entry after it (or before, at the end) is current.
  @discardableResult
  mutating func remove(at i: Int) throws -> Bool {
    let removed = entries.remove(at: try checked(i))
    let wasCurrent = i == index
    unshuffled?.removeAll { $0 == removed.id }
    if i < index { index -= 1 }
    if entries.isEmpty { index = -1 }
    else if index >= entries.count { index = entries.count - 1 }
    return wasCurrent
  }

  mutating func move(from: Int, to: Int) throws {
    let currentId = current?.id
    let moved = entries.remove(at: try checked(from))
    entries.insert(moved, at: min(max(to, 0), entries.count))
    if let currentId { index = entries.firstIndex { $0.id == currentId }! }
  }

  mutating func select(_ i: Int) throws {
    index = try checked(i)
  }

  /// Shuffle keeps what has played and the current entry where they are, and shuffles what comes next.
  mutating func setShuffle(_ on: Bool) {
    guard on != shuffle else { return }
    shuffle = on
    if on {
      unshuffled = entries.map(\.id)
      let start = index + 1
      if start < entries.count { entries[start...].shuffle() }
    } else {
      let byId = Dictionary(uniqueKeysWithValues: entries.map { ($0.id, $0) })
      let currentId = current?.id
      entries = (unshuffled ?? []).compactMap { byId[$0] }
      unshuffled = nil
      if let currentId { index = entries.firstIndex { $0.id == currentId }! }
    }
  }

  /// Where Next goes: the following entry, the first one when wrapping, or nil at the end.
  func nextIndex(wrapping: Bool) -> Int? {
    if index + 1 < entries.count { return index + 1 }
    return wrapping && !entries.isEmpty ? 0 : nil
  }

  var snapshot: QueueSnapshot {
    QueueSnapshot(
      items: entries, index: index, source: source, shuffle: shuffle, repeat: repeatMode, autoplay: autoplay)
  }
}

/// Decides that the current track has ended or failed, at most once per start. A state only counts after the same
/// document has reported that track loading, playing or paused since it started, so a duplicate `ended`, or a late
/// one from the previous play of the same videoId (repeat one, or the same song twice in a row), cannot skip again.
struct TrackGuard: Equatable {
  enum Outcome: Equatable { case none, ended, failed }

  private(set) var videoId: String?
  private var armedGeneration: Int?

  mutating func start(_ videoId: String) {
    self.videoId = videoId
    armedGeneration = nil
  }

  mutating func observe(_ state: PlayerState, generation: Int) -> Outcome {
    guard let videoId, state.videoId == videoId else { return .none }
    switch state.status {
    case .loading, .playing, .paused:
      armedGeneration = generation
      return .none
    case .ended, .error:
      guard armedGeneration == generation else { return .none }
      armedGeneration = nil
      return state.status == .ended ? .ended : .failed
    case .idle:
      return .none
    }
  }
}

/// What the queue needs from the player. `Player` conforms; tests use a fake.
@MainActor
protocol QueuePlayer: AnyObject {
  var state: PlayerState { get }
  var generation: Int { get }
  func load(_ params: LoadParams) async
  func cue(_ params: LoadParams, at seconds: Double)
  func preloadHome()
  func play() async throws
  func pause() async throws
  func seek(_ seconds: Double) async throws
}

extension Player: QueuePlayer {}

/// What is saved to disk: the queue and the position in the current track.
struct SavedQueue: Codable, Equatable {
  var queue: QueueState
  var position: Double
}

/// The queue file in Application Support.
struct QueueStore {
  let url: URL

  static var standard: QueueStore {
    let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    return QueueStore(url: support.appending(path: "Melo/queue.json"))
  }

  func load() -> SavedQueue? {
    guard let data = try? Data(contentsOf: url) else { return nil }
    guard let saved = try? JSONDecoder().decode(SavedQueue.self, from: data), saved.queue.isValid else {
      queueLog.error("Ignored an unreadable saved queue")
      return nil
    }
    return saved
  }

  func delete() {
    try? FileManager.default.removeItem(at: url)
  }

  func save(_ saved: SavedQueue) {
    do {
      try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
      try JSONEncoder().encode(saved).write(to: url, options: .atomic)
    } catch {
      queueLog.error("Could not save the queue: \(error.localizedDescription, privacy: .public)")
    }
  }
}

@MainActor
final class Queue {
  static var shared: Queue?
  /// Consecutive unplayable tracks after which the queue stops instead of skipping again.
  static let failureLimit = 3
  /// Previous restarts the track instead when it has played longer than this.
  static let restartThreshold = 3.0
  /// Up next entries below which autoplay asks the UI for more radio.
  static let lowWater = 3

  private(set) var state = QueueState()
  let player: any QueuePlayer
  var onEvent: ((Event) -> Void)?
  private let store: QueueStore?
  private var track = TrackGuard()
  private var failures = 0
  /// Set when the queue ran out with autoplay on; the next append starts playing.
  private(set) var waitingForMore = false
  private var lastNeedsMore: NeedsMore?
  private var saveTask: Task<Void, Never>?
  private var lastPositionSave = ContinuousClock.now

  init(player: any QueuePlayer, store: QueueStore?) {
    self.player = player
    self.store = store
  }

  // MARK: Launch

  /// Restores the saved queue paused at its position, or preloads YouTube Music's home when there is none.
  func restore() {
    guard let saved = store?.load(), let entry = saved.queue.current else { return player.preloadHome() }
    state = saved.queue
    track.start(entry.item.videoId)
    player.cue(LoadParams(videoId: entry.item.videoId), at: saved.position)
    queueLog.info("Restored \(self.state.entries.count) entries at \(self.state.index)")
    changed(save: false)
  }

  // MARK: Requests

  func set(_ items: [QueueItem], at index: Int, source: QueueSource?, continuation: String?) async throws {
    try state.replace(with: items, at: index, source: source, continuation: continuation)
    failures = 0
    changed()
    await start()
  }

  func playNext(_ item: QueueItem) async {
    let wasEmpty = state.current == nil
    state.playNext(item)
    changed()
    if wasEmpty { await start() }
  }

  func add(_ item: QueueItem) async {
    let wasEmpty = state.current == nil
    state.add(item)
    changed()
    if wasEmpty { await start() }
  }

  /// Radio items for `needsMore`. Dropped when the queue's last entry is no longer the one they were fetched after.
  func append(_ items: [QueueItem], continuation: String?, after: Int) async {
    guard state.entries.last?.id == after else {
      queueLog.info("Dropped a stale radio append")
      return
    }
    let added = state.append(items, continuation: continuation)
    queueLog.info("Radio appended \(added) of \(items.count)")
    if waitingForMore, added > 0, let next = state.nextIndex(wrapping: false) {
      try? state.select(next)
      changed()
      await start()
    } else {
      changed()
    }
  }

  func remove(at index: Int) async throws {
    let wasCurrent = try state.remove(at: index)
    changed()
    // Removing the playing entry plays the one after it, or stops when it was the last.
    if wasCurrent {
      if index < state.entries.count { await start() } else { try? await player.pause() }
    }
  }

  func move(from: Int, to: Int) throws {
    try state.move(from: from, to: to)
    changed()
  }

  func jump(to index: Int) async throws {
    try state.select(index)
    failures = 0
    changed()
    await start()
  }

  func next() async {
    failures = 0
    await advance(.manual)
  }

  /// Restarts the track after the first few seconds; otherwise goes to the entry before it.
  func previous() async {
    let playing = player.state.videoId == state.current?.item.videoId
    if playing, player.state.currentTime > Self.restartThreshold || state.index <= 0 {
      let ended = player.state.status == .ended
      try? await player.seek(0)
      if ended { try? await player.play() }
      return
    }
    guard state.index > 0 else { return }
    try? state.select(state.index - 1)
    failures = 0
    changed()
    await start()
  }

  func setShuffle(_ on: Bool) {
    state.setShuffle(on)
    changed()
  }

  func setRepeat(_ mode: RepeatMode) {
    state.repeatMode = mode
    changed()
  }

  func setAutoplay(_ on: Bool) {
    state.autoplay = on
    lastNeedsMore = nil
    changed()
  }

  /// Empties the queue, stops playback and deletes the saved queue, keeping the autoplay setting. Used on sign-out,
  /// so the next account does not inherit the last one's queue.
  func clear() async {
    saveTask?.cancel()
    var cleared = QueueState()
    cleared.autoplay = state.autoplay
    state = cleared
    waitingForMore = false
    lastNeedsMore = nil
    failures = 0
    track = TrackGuard()
    try? await player.pause()
    store?.delete()
    changed(save: false)
  }

  /// The snapshot, for a UI that has just loaded. Also re-sends `needsMore` if it still applies, in case the UI
  /// missed it or its fetch failed.
  func snapshot() -> QueueSnapshot {
    lastNeedsMore = nil
    requestMoreIfNeeded()
    return state.snapshot
  }

  // MARK: Transport, for media keys

  /// Plays the current entry, loading it first if the player holds something else.
  func play() async {
    guard let entry = state.current else { return }
    if player.state.videoId != entry.item.videoId { return await start() }
    try? await player.play()
  }

  func pause() async {
    try? await player.pause()
  }

  func toggle() async {
    if [.playing, .loading].contains(player.state.status) { await pause() } else { await play() }
  }

  // MARK: Player state

  /// Called with every player state: advances when the current track ends, skips it once when it fails.
  func handle(_ playerState: PlayerState) async {
    guard let entry = state.current else { return }
    let outcome = track.observe(playerState, generation: player.generation)
    if playerState.videoId == entry.item.videoId, playerState.status == .playing {
      failures = 0
      if ContinuousClock.now - lastPositionSave > .seconds(10) { save() }
    }
    switch outcome {
    case .none:
      if playerState.status == .paused, playerState.videoId == entry.item.videoId { scheduleSave() }
    case .ended:
      queueLog.info("Ended \(entry.item.videoId, privacy: .public)")
      await advance(.ended)
    case .failed:
      failures += 1
      let skip = failures < Self.failureLimit
      queueLog.warning("Unplayable \(entry.item.videoId, privacy: .public), \(skip ? "skipping" : "stopping")")
      onEvent?(.queueUnplayable(Unplayable(videoId: entry.item.videoId, title: entry.item.title, skipped: skip)))
      if skip { await advance(.failed) }
    }
  }

  // MARK: Internals

  private enum Reason { case manual, ended, failed }

  private func advance(_ reason: Reason) async {
    if reason == .ended, state.repeatMode == .one, let entry = state.current {
      track.start(entry.item.videoId)
      try? await player.seek(0)
      try? await player.play()
      return
    }
    if let next = state.nextIndex(wrapping: state.repeatMode == .all) {
      try? state.select(next)
      changed()
      return await start()
    }
    // The end of the queue. Autoplay waits for the radio; otherwise playback stops here.
    if state.autoplay, state.current != nil {
      waitingForMore = true
      lastNeedsMore = nil
      requestMoreIfNeeded()
    }
    queueLog.info("End of queue\(self.waitingForMore ? ", waiting for radio" : "", privacy: .public)")
    if reason == .manual { try? await player.pause() }
  }

  private func start() async {
    guard let entry = state.current else { return }
    waitingForMore = false
    track.start(entry.item.videoId)
    await player.load(LoadParams(videoId: entry.item.videoId))
  }

  private func changed(save: Bool = true) {
    onEvent?(.queueChanged(state.snapshot))
    requestMoreIfNeeded()
    if save { scheduleSave() }
  }

  /// Asks for radio once per (last entry, continuation) while autoplay is on and few entries remain.
  private func requestMoreIfNeeded() {
    guard state.autoplay, state.repeatMode != .all, let last = state.entries.last, state.remaining < Self.lowWater
    else { return }
    let request = NeedsMore(videoId: last.item.videoId, continuation: state.continuation, after: last.id)
    guard request != lastNeedsMore else { return }
    lastNeedsMore = request
    onEvent?(.queueNeedsMore(request))
  }

  private func scheduleSave() {
    guard store != nil else { return }
    saveTask?.cancel()
    saveTask = Task { [weak self] in
      try? await Task.sleep(for: .seconds(1))
      guard !Task.isCancelled else { return }
      self?.save()
    }
  }

  /// Writes the queue now. The app also calls this when it quits.
  func save() {
    guard let store else { return }
    saveTask?.cancel()
    lastPositionSave = .now
    let playerState = player.state
    let position =
      playerState.videoId == state.current?.item.videoId && playerState.status != .ended ? playerState.currentTime : 0
    store.save(SavedQueue(queue: state, position: position))
  }
}
