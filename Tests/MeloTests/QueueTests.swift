// The queue: every operation on QueueState, the once-per-track guard, auto-advance against a fake player (including
// the duplicate and late `ended` events behind Kaset issues #280 and #409), shuffle and repeat, the skip-on-error cap,
// radio requests, persistence, the queue bridge messages, and the Now Playing claim and command debounce.
import Foundation
import Testing

@testable import Melo

func item(_ videoId: String) -> QueueItem {
  QueueItem(videoId: videoId, title: "Title \(videoId)", artists: [.init(name: "Artist")], durationSec: 200)
}

func items(_ ids: String...) -> [QueueItem] { ids.map(item) }

extension QueueState {
  var ids: [String] { entries.map(\.item.videoId) }
}

@Suite struct QueueStateTests {
  func state(_ ids: [String], at index: Int = 0) throws -> QueueState {
    var state = QueueState()
    try state.replace(with: ids.map(item), at: index, source: QueueSource(title: "Album"), continuation: nil)
    return state
  }

  @Test func replaceSetsEntriesIndexAndSource() throws {
    let state = try state(["a", "b", "c"], at: 1)
    #expect(state.ids == ["a", "b", "c"])
    #expect(state.index == 1)
    #expect(state.current?.item.videoId == "b")
    #expect(state.source == QueueSource(title: "Album"))
    #expect(Set(state.entries.map(\.id)).count == 3)
    let empty = QueueState()
    #expect(throws: QueueError.self) { var copy = empty; try copy.replace(with: items("a"), at: 1, source: nil, continuation: nil) }
    #expect(throws: QueueError.self) { var copy = empty; try copy.replace(with: [], at: 0, source: nil, continuation: nil) }
  }

  @Test func playNextInsertsAfterCurrentAndAddAppends() throws {
    var state = try state(["a", "b", "c"], at: 1)
    state.playNext(item("x"))
    state.add(item("y"))
    #expect(state.ids == ["a", "b", "x", "c", "y"])
    #expect(state.index == 1)
    var empty = QueueState()
    empty.add(item("a"))
    #expect(empty.index == 0)
    var emptyNext = QueueState()
    emptyNext.playNext(item("a"))
    #expect(emptyNext.index == 0 && emptyNext.ids == ["a"])
  }

  @Test func sameSongTwiceGetsDistinctIds() throws {
    var state = try state(["a"])
    state.add(item("a"))
    #expect(state.entries[0].id != state.entries[1].id)
  }

  @Test func appendSkipsQueuedVideoIdsAndKeepsContinuation() throws {
    var state = try state(["a", "b"])
    let added = state.append(items("b", "c", "c", "d"), continuation: "next")
    #expect(added == 2)
    #expect(state.ids == ["a", "b", "c", "d"])
    #expect(state.continuation == "next")
    let none = state.append(items("a"), continuation: nil)
    #expect(none == 0)
    #expect(state.continuation == nil)
  }

  @Test func removeKeepsTheCurrentEntry() throws {
    var state = try state(["a", "b", "c", "d"], at: 2)
    let removed0_false = try state.remove(at: 0)
    #expect(removed0_false == false)
    #expect(state.ids == ["b", "c", "d"] && state.index == 1)
    let removed2_false = try state.remove(at: 2)
    #expect(removed2_false == false)
    #expect(state.ids == ["b", "c"] && state.index == 1)
    let removed1_true = try state.remove(at: 1)
    #expect(removed1_true == true)  // the current, at the end: the one before becomes current
    #expect(state.ids == ["b"] && state.index == 0)
    let removed0_true = try state.remove(at: 0)
    #expect(removed0_true == true)
    #expect(state.ids.isEmpty && state.index == -1)
    #expect(throws: QueueError.self) { var copy = state; try copy.remove(at: 0) }
  }

  @Test func removeCurrentMakesTheNextCurrent() throws {
    var state = try state(["a", "b", "c"], at: 1)
    let removed = try state.remove(at: 1)
    #expect(removed)
    #expect(state.current?.item.videoId == "c")
  }

  @Test func moveFollowsTheCurrentEntry() throws {
    var state = try state(["a", "b", "c", "d"], at: 1)
    try state.move(from: 3, to: 0)
    #expect(state.ids == ["d", "a", "b", "c"] && state.index == 2)
    try state.move(from: 2, to: 3)  // the current itself
    #expect(state.ids == ["d", "a", "c", "b"] && state.index == 3)
    try state.move(from: 0, to: 99)  // clamped to the end
    #expect(state.ids == ["a", "c", "b", "d"] && state.index == 2)
    #expect(throws: QueueError.self) { var copy = state; try copy.move(from: 9, to: 0) }
  }

  @Test func selectChecksTheIndex() throws {
    var state = try state(["a", "b"])
    try state.select(1)
    #expect(state.index == 1)
    #expect(throws: QueueError.self) { var copy = state; try copy.select(2) }
    #expect(throws: QueueError.self) { var copy = state; try copy.select(-1) }
  }

  @Test func nextIndexWrapsOnlyWhenAsked() throws {
    var state = try state(["a", "b"])
    #expect(state.nextIndex(wrapping: false) == 1)
    try state.select(1)
    #expect(state.nextIndex(wrapping: false) == nil)
    #expect(state.nextIndex(wrapping: true) == 0)
    #expect(QueueState().nextIndex(wrapping: true) == nil)
  }

  @Test func shuffleKeepsHistoryAndCurrentAndRestores() throws {
    let ids = (0..<30).map { "v\($0)" }
    var state = try state(ids, at: 10)
    state.setShuffle(true)
    #expect(state.shuffle)
    #expect(Array(state.ids[...10]) == Array(ids[...10]))
    #expect(state.index == 10)
    #expect(Set(state.ids) == Set(ids) && state.ids.count == 30)
    #expect(Array(state.ids[11...]) != Array(ids[11...]))  // 19! orders: a repeat is not a real risk
    state.setShuffle(false)
    #expect(!state.shuffle)
    #expect(state.ids == ids && state.index == 10)
  }

  @Test func unshuffleRestoresOrderAfterEditsAndFollowsCurrent() throws {
    let ids = (0..<10).map { "v\($0)" }
    var state = try state(ids, at: 2)
    state.setShuffle(true)
    state.playNext(item("next"))
    state.add(item("last"))
    _ = state.append(items("radio"), continuation: nil)
    let removed = state.ids.firstIndex(of: "v5")!
    try state.remove(at: removed)
    try state.select(state.ids.firstIndex(of: "v7")!)
    state.setShuffle(false)
    #expect(state.ids == ["v0", "v1", "v2", "next", "v3", "v4", "v6", "v7", "v8", "v9", "last", "radio"])
    #expect(state.current?.item.videoId == "v7")
    #expect(state.unshuffled == nil)
  }

  @Test func replaceWhileShuffledPlaysTheChosenItemFirst() throws {
    var state = QueueState()
    state.setShuffle(true)
    let ids = (0..<20).map { "v\($0)" }
    try state.replace(with: ids.map(item), at: 7, source: nil, continuation: nil)
    #expect(state.index == 0 && state.current?.item.videoId == "v7")
    #expect(Set(state.ids) == Set(ids))
    state.setShuffle(false)
    #expect(state.ids == ids && state.index == 7)
  }

  @Test func codableRoundTripAndValidity() throws {
    var state = try state(["a", "b", "c"], at: 1)
    state.setShuffle(true)
    state.repeatMode = .all
    state.continuation = "token"
    let decoded = try JSONDecoder().decode(QueueState.self, from: JSONEncoder().encode(state))
    #expect(decoded == state && decoded.isValid)
    #expect(QueueState().isValid)
    var json = try #require(try JSONSerialization.jsonObject(with: JSONEncoder().encode(state)) as? [String: Any])
    json["index"] = 5
    let broken = try JSONDecoder().decode(QueueState.self, from: JSONSerialization.data(withJSONObject: json))
    #expect(!broken.isValid)
  }
}

@Suite struct TrackGuardTests {
  func state(_ status: PlayerState.Status, _ id: String?) -> PlayerState {
    var state = PlayerState.idle
    state.status = status
    state.videoId = id
    return state
  }

  @Test func endsOnceAfterArming() {
    var guardian = TrackGuard()
    guardian.start("a")
    #expect(guardian.observe(state(.ended, "a"), generation: 1) == .none)  // not armed yet: a late end
    #expect(guardian.observe(state(.loading, "a"), generation: 1) == .none)
    #expect(guardian.observe(state(.playing, "a"), generation: 1) == .none)
    #expect(guardian.observe(state(.ended, "a"), generation: 1) == .ended)
    #expect(guardian.observe(state(.ended, "a"), generation: 1) == .none)  // duplicate
    #expect(guardian.observe(state(.ended, "a"), generation: 1) == .none)
  }

  @Test func ignoresOtherTracksAndDocuments() {
    var guardian = TrackGuard()
    guardian.start("b")
    #expect(guardian.observe(state(.playing, "a"), generation: 1) == .none)
    #expect(guardian.observe(state(.ended, "a"), generation: 1) == .none)
    #expect(guardian.observe(state(.playing, "b"), generation: 1) == .none)
    #expect(guardian.observe(state(.ended, "b"), generation: 2) == .none)  // another document
    #expect(guardian.observe(state(.ended, "b"), generation: 1) == .ended)
  }

  @Test func restartingTheSameTrackDisarms() {
    var guardian = TrackGuard()
    guardian.start("a")
    _ = guardian.observe(state(.playing, "a"), generation: 1)
    #expect(guardian.observe(state(.ended, "a"), generation: 1) == .ended)
    guardian.start("a")  // repeat one, or the same song next in the queue
    #expect(guardian.observe(state(.ended, "a"), generation: 1) == .none)
    _ = guardian.observe(state(.playing, "a"), generation: 1)
    #expect(guardian.observe(state(.ended, "a"), generation: 1) == .ended)
  }

  @Test func failsOnce() {
    var guardian = TrackGuard()
    guardian.start("a")
    _ = guardian.observe(state(.loading, "a"), generation: 3)
    #expect(guardian.observe(state(.error, "a"), generation: 3) == .failed)
    #expect(guardian.observe(state(.error, "a"), generation: 3) == .none)
  }
}

@MainActor
final class FakePlayer: QueuePlayer {
  var state = PlayerState.idle
  var generation = 1
  var calls: [String] = []
  var loads: [String] { calls.filter { $0.hasPrefix("load:") }.map { String($0.dropFirst(5)) } }

  func load(_ params: LoadParams) async {
    calls.append("load:\(params.videoId)")
    // Like Player's router load: the page reports the new track loading.
    state = PlayerState(status: .loading, videoId: params.videoId, currentTime: 0, duration: 0, volume: 1, isAd: false)
  }
  func cue(_ params: LoadParams, at seconds: Double) { calls.append("cue:\(params.videoId)@\(seconds)") }
  func preloadHome() { calls.append("home") }
  func play() async throws { calls.append("play") }
  func pause() async throws { calls.append("pause") }
  func seek(_ seconds: Double) async throws { calls.append("seek:\(seconds)") }
}

@MainActor @Suite struct QueueControllerTests {
  let player = FakePlayer()
  let queue: Queue
  var events: [Event] { recorder.events }
  let recorder = Recorder()

  final class Recorder {
    var events: [Event] = []
  }

  init() {
    queue = Queue(player: player, store: nil)
    queue.setAutoplay(false)
    let recorder = recorder
    queue.onEvent = { recorder.events.append($0) }
  }

  /// The page reports `status` for `id` (the current track by default).
  func send(_ status: PlayerState.Status, _ id: String? = nil, at time: Double = 10) async {
    player.state = PlayerState(
      status: status, videoId: id ?? queue.state.current?.item.videoId, title: "Page title", currentTime: time,
      duration: 200, volume: 1, isAd: false)
    await queue.handle(player.state)
  }

  /// Plays the current track to its end.
  func finish() async {
    await send(.playing)
    await send(.ended)
  }

  var needsMore: [NeedsMore] {
    events.compactMap { if case .queueNeedsMore(let request) = $0 { request } else { nil } }
  }

  var unplayable: [Unplayable] {
    events.compactMap { if case .queueUnplayable(let event) = $0 { event } else { nil } }
  }

  @Test func setLoadsTheChosenTrackAndEmitsASnapshot() async throws {
    try await queue.set(items("a", "b", "c"), at: 1, source: QueueSource(title: "Album", browseId: "MPREb_1"), continuation: nil)
    #expect(player.loads == ["b"])
    guard case .queueChanged(let snapshot) = events.last else { Issue.record("no snapshot"); return }
    #expect(snapshot.index == 1 && snapshot.items.map(\.item.videoId) == ["a", "b", "c"])
    #expect(snapshot.source?.browseId == "MPREb_1")
  }

  @Test func advancesExactlyOncePerTrack() async throws {
    try await queue.set(items("a", "b", "c"), at: 0, source: nil, continuation: nil)
    await finish()
    #expect(player.loads == ["a", "b"])
    // The outgoing page repeats its ended state, and stale messages for the old track arrive late.
    await send(.ended, "a")
    await send(.ended, "a")
    await send(.playing, "a")
    await send(.ended, "a")
    #expect(player.loads == ["a", "b"])
    #expect(queue.state.index == 1)
    await finish()
    #expect(player.loads == ["a", "b", "c"])
  }

  @Test func duplicateEndedForTheNewTrackBeforeItLoadsIsIgnored() async throws {
    try await queue.set(items("a", "b"), at: 0, source: nil, continuation: nil)
    await send(.playing)
    // Two ended events arrive back to back, the second while the next track is still loading.
    await send(.ended)
    await send(.ended, "b")
    #expect(player.loads == ["a", "b"])
    #expect(queue.state.index == 1)
  }

  @Test func sameSongTwiceInARowPlaysTwiceNotThreeTimes() async throws {
    // Issue #409's shape: the late `ended` of the first play must not end the second.
    try await queue.set(items("a", "a", "b"), at: 0, source: nil, continuation: nil)
    await send(.playing)
    await send(.ended)
    #expect(player.loads == ["a", "a"])
    player.state.status = .ended  // a late copy of the first play's end, before the second reports anything
    await queue.handle(player.state)
    #expect(player.loads == ["a", "a"])
    await finish()
    #expect(player.loads == ["a", "a", "b"])
  }

  @Test func stopsAtTheEndWithRepeatOff() async throws {
    try await queue.set(items("a", "b"), at: 0, source: nil, continuation: nil)
    await finish()
    await finish()
    #expect(player.loads == ["a", "b"])
    #expect(queue.state.index == 1)
    #expect(!player.calls.contains("pause"))  // the page is already stopped at the end
    await send(.ended)
    #expect(player.loads == ["a", "b"])
  }

  @Test func repeatAllWraps() async throws {
    try await queue.set(items("a", "b"), at: 0, source: nil, continuation: nil)
    queue.setRepeat(.all)
    await finish()
    await finish()
    #expect(player.loads == ["a", "b", "a"])
    #expect(queue.state.index == 0)
  }

  @Test func repeatOneRestartsOnceWithoutLoading() async throws {
    try await queue.set(items("a", "b"), at: 0, source: nil, continuation: nil)
    queue.setRepeat(.one)
    await finish()
    #expect(player.calls == ["load:a", "seek:0.0", "play"])
    await send(.ended)  // duplicate
    #expect(player.calls == ["load:a", "seek:0.0", "play"])
    await finish()
    #expect(player.calls.filter { $0 == "play" }.count == 2)
    #expect(player.loads == ["a"])
    // Next still moves on with repeat one.
    await queue.next()
    #expect(player.loads == ["a", "b"])
  }

  @Test func nextAndJump() async throws {
    try await queue.set(items("a", "b", "c"), at: 0, source: nil, continuation: nil)
    await queue.next()
    try await queue.jump(to: 0)
    #expect(player.loads == ["a", "b", "a"])
    await #expect(throws: QueueError.self) { try await queue.jump(to: 3) }
    try await queue.jump(to: 2)
    await queue.next()  // at the end with autoplay off: pause
    #expect(player.calls.last == "pause")
    #expect(queue.state.index == 2)
  }

  @Test func previousRestartsAfterThreeSeconds() async throws {
    try await queue.set(items("a", "b"), at: 1, source: nil, continuation: nil)
    await send(.playing, at: 3.5)
    await queue.previous()
    #expect(player.calls.last == "seek:0.0")
    #expect(player.loads == ["b"])
    await send(.playing, at: 2)
    await queue.previous()
    #expect(player.loads == ["b", "a"])
    #expect(queue.state.index == 0)
    await send(.playing, at: 1)
    await queue.previous()  // the first track: restart
    #expect(player.calls.last == "seek:0.0")
    #expect(player.loads == ["b", "a"])
  }

  @Test func previousOnAnEndedTrackRestartsAndPlays() async throws {
    try await queue.set(items("a", "b"), at: 1, source: nil, continuation: nil)
    await finish()
    await queue.previous()
    #expect(Array(player.calls.suffix(2)) == ["seek:0.0", "play"])
    // After the restart the track can end and stop again.
    await finish()
    #expect(player.loads == ["b"])
  }

  @Test func removeTheCurrentTrackPlaysTheNextOrStops() async throws {
    try await queue.set(items("a", "b", "c"), at: 1, source: nil, continuation: nil)
    try await queue.remove(at: 1)
    #expect(player.loads == ["b", "c"])
    try await queue.remove(at: 0)
    #expect(player.loads == ["b", "c"] && queue.state.index == 0)
    try await queue.remove(at: 0)
    #expect(player.calls.last == "pause" && queue.state.index == -1)
  }

  @Test func addToAnEmptyQueueStartsPlaying() async {
    await queue.add(item("a"))
    await queue.playNext(item("b"))
    #expect(player.loads == ["a"])
    #expect(queue.state.ids == ["a", "b"])
  }

  /// The page reports the current track loading, then failing.
  func fail() async {
    await send(.loading, at: 0)
    await send(.error, at: 0)
  }

  @Test func unplayableTracksSkipOnceAndStopAfterThreeInARow() async throws {
    try await queue.set(items("a", "b", "c", "d", "e"), at: 0, source: nil, continuation: nil)
    await fail()
    await send(.error, "a")  // repeated: one skip only
    #expect(player.loads == ["a", "b"])
    #expect(unplayable == [Unplayable(videoId: "a", title: "Title a", skipped: true)])
    await fail()
    await fail()
    #expect(player.loads == ["a", "b", "c"])
    #expect(unplayable.map(\.skipped) == [true, true, false])
    #expect(queue.state.index == 2)
  }

  @Test func aTrackThatPlaysResetsTheFailureCount() async throws {
    try await queue.set(items("a", "b", "c", "d", "e"), at: 0, source: nil, continuation: nil)
    await fail()
    await fail()
    await finish()  // c plays to its end
    await fail()  // d fails: a fresh count
    #expect(player.loads == ["a", "b", "c", "d", "e"])
    #expect(unplayable.map(\.skipped) == [true, true, true])
  }

  @Test func autoplayAsksForRadioOncePerTail() async throws {
    queue.setAutoplay(true)
    try await queue.set(items("a", "b", "c", "d"), at: 0, source: nil, continuation: nil)
    #expect(needsMore.isEmpty)
    await finish()
    let tail = try #require(queue.state.entries.last?.id)
    #expect(needsMore == [NeedsMore(videoId: "d", continuation: nil, after: tail)])
    await finish()
    #expect(needsMore.count == 1)
    // A new tail with a continuation asks again, from the continuation.
    await queue.append(items("e"), continuation: "more", after: tail)
    let newTail = try #require(queue.state.entries.last?.id)
    #expect(needsMore.last == NeedsMore(videoId: "e", continuation: "more", after: newTail))
    // queue.get re-sends it for a UI that missed it.
    _ = queue.snapshot()
    #expect(needsMore.count == 3)
  }

  @Test func autoplayWaitsAtTheEndAndPlaysTheAppendedRadio() async throws {
    queue.setAutoplay(true)
    try await queue.set(items("a"), at: 0, source: nil, continuation: nil)
    let request = try #require(needsMore.last)
    await finish()
    #expect(queue.waitingForMore)
    await queue.append(items("a", "r1", "r2"), continuation: "c2", after: request.after)
    #expect(player.loads == ["a", "r1"])
    #expect(queue.state.ids == ["a", "r1", "r2"] && queue.state.continuation == "c2")
    #expect(!queue.waitingForMore)
  }

  @Test func staleRadioAppendIsDropped() async throws {
    queue.setAutoplay(true)
    try await queue.set(items("a"), at: 0, source: nil, continuation: nil)
    let request = try #require(needsMore.last)
    try await queue.set(items("x", "y"), at: 0, source: nil, continuation: nil)
    await queue.append(items("r1"), continuation: nil, after: request.after)
    #expect(queue.state.ids == ["x", "y"])
  }

  @Test func repeatAllNeedsNoRadio() async throws {
    queue.setAutoplay(true)
    queue.setRepeat(.all)
    try await queue.set(items("a"), at: 0, source: nil, continuation: nil)
    #expect(needsMore.isEmpty)
  }

  @Test func transportLoadsTheCurrentTrackWhenThePlayerHoldsAnother() async throws {
    try await queue.set(items("a"), at: 0, source: nil, continuation: nil)
    await send(.paused)
    await queue.toggle()
    #expect(player.calls.last == "play")
    player.state.status = .playing
    await queue.toggle()
    #expect(player.calls.last == "pause")
    player.state.videoId = "other"
    player.state.status = .idle
    await queue.play()
    #expect(player.loads == ["a", "a"])
  }
}

@MainActor @Suite struct QueuePersistenceTests {
  let url = FileManager.default.temporaryDirectory.appending(path: "melo-queue-test-\(UUID().uuidString)/queue.json")

  @Test func savesAndRestoresPausedAtThePosition() async throws {
    let store = QueueStore(url: url)
    defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let player = FakePlayer()
    let queue = Queue(player: player, store: store)
    try await queue.set(items("a", "b", "c"), at: 1, source: QueueSource(title: "Album"), continuation: "token")
    queue.setShuffle(true)
    queue.setRepeat(.one)
    player.state.status = .paused
    player.state.currentTime = 42.5
    queue.save()

    let restoredPlayer = FakePlayer()
    let restored = Queue(player: restoredPlayer, store: store)
    restored.restore()
    #expect(restored.state == queue.state)
    #expect(restoredPlayer.calls == ["cue:\(queue.state.current!.item.videoId)@42.5"])
    // The restored track still advances once it plays and ends.
    restoredPlayer.state = PlayerState(
      status: .paused, videoId: restored.state.current?.item.videoId, currentTime: 42.5, duration: 200, volume: 1,
      isAd: false)
    await restored.handle(restoredPlayer.state)
    restoredPlayer.state.status = .ended
    await restored.handle(restoredPlayer.state)
    #expect(restoredPlayer.calls.suffix(2) == ["seek:0.0", "play"])  // repeat one
  }

  @Test func anEndedTrackRestoresFromTheStart() async throws {
    let store = QueueStore(url: url)
    defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let player = FakePlayer()
    let queue = Queue(player: player, store: store)
    queue.setAutoplay(false)
    try await queue.set(items("a"), at: 0, source: nil, continuation: nil)
    player.state = PlayerState(status: .ended, videoId: "a", currentTime: 200, duration: 200, volume: 1, isAd: false)
    queue.save()
    #expect(store.load()?.position == 0)
  }

  @Test func noOrBrokenFilePreloadsHome() throws {
    let store = QueueStore(url: url)
    defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let player = FakePlayer()
    Queue(player: player, store: store).restore()
    #expect(player.calls == ["home"])
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try Data("{\"queue\":{\"entries\":[],\"index\":4},\"position\":0}".utf8).write(to: url)
    #expect(store.load() == nil)
    try Data("not json".utf8).write(to: url)
    #expect(store.load() == nil)
  }
}

@Suite struct QueueProtocolTests {
  func decode(_ body: Any) throws -> Request {
    try JSONDecoder().decode(Request.self, from: JSONSerialization.data(withJSONObject: body))
  }

  let rawItem: [String: Any] = [
    "videoId": "7qQg6YbSMko", "title": "Prélude", "artists": [["name": "Pablo Casals", "browseId": "UC1"]],
    "album": ["name": "Bach", "browseId": "MPREb_1"], "durationSec": 149, "thumbnailUrl": "https://i.ytimg.com/x.jpg",
    "isVideo": false,
  ]

  @Test func decodesQueueRequests() throws {
    let full = QueueItem(
      videoId: "7qQg6YbSMko", title: "Prélude", artists: [.init(name: "Pablo Casals", browseId: "UC1")],
      album: .init(name: "Bach", browseId: "MPREb_1"), durationSec: 149, thumbnailUrl: "https://i.ytimg.com/x.jpg",
      isVideo: false)
    let minimal: [String: Any] = ["videoId": "udWzGOcAy2g", "title": "T", "artists": []]
    #expect(try decode(["method": "queue.get", "params": [:]]) == .queueGet)
    #expect(
      try decode([
        "method": "queue.set",
        "params": ["items": [rawItem, minimal], "index": 1, "source": ["title": "Album"], "continuation": "c"],
      ])
        == .queueSet(
          QueueSetParams(
            items: [full, QueueItem(videoId: "udWzGOcAy2g", title: "T")], index: 1, source: QueueSource(title: "Album"),
            continuation: "c")))
    #expect(try decode(["method": "queue.playNext", "params": ["item": rawItem]]) == .queuePlayNext(QueueItemParams(item: full)))
    #expect(try decode(["method": "queue.add", "params": ["item": rawItem]]) == .queueAdd(QueueItemParams(item: full)))
    #expect(try decode(["method": "queue.remove", "params": ["index": 2]]) == .queueRemove(QueueIndexParams(index: 2)))
    #expect(try decode(["method": "queue.jump", "params": ["index": 0]]) == .queueJump(QueueIndexParams(index: 0)))
    #expect(try decode(["method": "queue.move", "params": ["from": 3, "to": 1]]) == .queueMove(QueueMoveParams(from: 3, to: 1)))
    #expect(try decode(["method": "queue.next", "params": [:]]) == .queueNext)
    #expect(try decode(["method": "queue.previous", "params": [:]]) == .queuePrevious)
    #expect(
      try decode(["method": "queue.setShuffle", "params": ["enabled": true]]) == .queueSetShuffle(QueueFlagParams(enabled: true)))
    #expect(
      try decode(["method": "queue.setAutoplay", "params": ["enabled": false]])
        == .queueSetAutoplay(QueueFlagParams(enabled: false)))
    #expect(try decode(["method": "queue.setRepeat", "params": ["mode": "one"]]) == .queueSetRepeat(QueueRepeatParams(mode: .one)))
    #expect(
      try decode(["method": "queue.append", "params": ["items": [rawItem], "after": 7]])
        == .queueAppend(QueueAppendParams(items: [full], continuation: nil, after: 7)))
  }

  @Test(arguments: ["", "abc');alert(1)//", "a b", "</script>"])
  func rejectsItemsWithUnsafeIds(id: String) {
    var bad = rawItem
    bad["videoId"] = id
    #expect(throws: DecodingError.self) { try decode(["method": "queue.add", "params": ["item": bad]]) }
    #expect(throws: DecodingError.self) {
      try decode(["method": "queue.set", "params": ["items": [bad], "index": 0]])
    }
  }

  @Test func rejectsMalformedQueueParams() {
    #expect(throws: DecodingError.self) { try decode(["method": "queue.setRepeat", "params": ["mode": "sometimes"]]) }
    #expect(throws: DecodingError.self) { try decode(["method": "queue.remove", "params": ["index": "1"]]) }
    #expect(throws: DecodingError.self) { try decode(["method": "queue.add", "params": ["item": ["videoId": "a"]]]) }
    #expect(throws: DecodingError.self) { try decode(["method": "queue.append", "params": ["items": []]]) }
  }

  @MainActor @Test func encodesQueueEvents() throws {
    var state = QueueState()
    try state.replace(with: items("a", "b"), at: 1, source: QueueSource(title: "Album"), continuation: "secret")
    state.repeatMode = .all
    let changed = try #require(try Bridge.json(Event.queueChanged(state.snapshot)) as? [String: Any])
    #expect(changed["name"] as? String == "queue.changed")
    let payload = try #require(changed["payload"] as? [String: Any])
    #expect(payload["index"] as? Int == 1)
    #expect(payload["repeat"] as? String == "all")
    #expect(payload["shuffle"] as? Bool == false)
    #expect(payload["autoplay"] as? Bool == true)
    #expect(payload["continuation"] == nil)  // radio tokens stay in Swift
    let entries = try #require(payload["items"] as? [[String: Any]])
    #expect((entries[1]["item"] as? [String: Any])?["videoId"] as? String == "b")
    #expect(entries[1]["id"] as? Int == 1)

    let more = try #require(
      try Bridge.json(Event.queueNeedsMore(NeedsMore(videoId: "b", continuation: nil, after: 1))) as? [String: Any])
    #expect(more["name"] as? String == "queue.needsMore")
    #expect(more["payload"] as? [String: AnyHashable] == ["videoId": "b", "after": 1])

    let unplayable = try #require(
      try Bridge.json(Event.queueUnplayable(Unplayable(videoId: "a", title: "T", skipped: true))) as? [String: Any])
    #expect(unplayable["name"] as? String == "queue.unplayable")
    #expect(unplayable["payload"] as? [String: AnyHashable] == ["videoId": "a", "title": "T", "skipped": true])
  }
}

@MainActor @Suite struct RemoteMessageTests {
  @Test func decodesMediaSessionActions() throws {
    let message = try #require(
      Player.decode(
        ["generation": 2, "action": "seekto", "seconds": 61.5], isMainFrame: true, scheme: "https",
        host: "music.youtube.com", as: RemoteMessage.self))
    #expect(message == RemoteMessage(generation: 2, action: .seekto, seconds: 61.5))
    let next = Player.decode(
      ["generation": 2, "action": "nexttrack", "seconds": NSNull()], isMainFrame: true, scheme: "https",
      host: "music.youtube.com", as: RemoteMessage.self)
    #expect(next == RemoteMessage(generation: 2, action: .nexttrack))
  }

  @Test func dropsForeignOrUnknownActions() {
    let body: [String: Any] = ["generation": 2, "action": "play"]
    #expect(Player.decode(body, isMainFrame: false, scheme: "https", host: "music.youtube.com", as: RemoteMessage.self) == nil)
    #expect(Player.decode(body, isMainFrame: true, scheme: "https", host: "evil.example", as: RemoteMessage.self) == nil)
    #expect(
      Player.decode(
        ["generation": 2, "action": "skipad"], isMainFrame: true, scheme: "https", host: "music.youtube.com",
        as: RemoteMessage.self) == nil)
  }
}

@MainActor @Suite struct NowPlayingTests {
  let queued = QueueItem(
    videoId: "a", title: "Queued title", artists: [.init(name: "One"), .init(name: "Two")],
    album: .init(name: "Album", browseId: "MPREb_1"), durationSec: 180, thumbnailUrl: "https://lh3.googleusercontent.com/x=w60-h60-l90-rj")

  func state(_ status: PlayerState.Status, _ id: String = "a") -> PlayerState {
    PlayerState(
      status: status, videoId: id, title: "Page title", artist: "Page artist", currentTime: 30, duration: 181, volume: 1,
      isAd: false)
  }

  @Test func handsOffToWebKitWhilePlaying() {
    #expect(NowPlaying.claim(for: state(.playing), item: queued) == .handsOff)
    #expect(NowPlaying.claim(for: state(.loading), item: queued) == .handsOff)
    #expect(NowPlaying.claim(for: state(.paused), item: nil) == .release)
  }

  @Test func claimsWhilePausedWithPageMetadataFirst() {
    let claim = NowPlaying.claim(for: state(.paused), item: queued)
    #expect(
      claim
        == .claim(
          .init(
            title: "Page title", artist: "Page artist", album: "Album", duration: 181, elapsed: 30,
            artworkUrl: "https://lh3.googleusercontent.com/x=w60-h60-l90-rj")))
  }

  @Test func claimsFromTheQueueWhenThePlayerHoldsSomethingElse() {
    // At launch the restored track is queued before the page has loaded it.
    let claim = NowPlaying.claim(for: .idle, item: queued)
    #expect(
      claim
        == .claim(
          .init(
            title: "Queued title", artist: "One, Two", album: "Album", duration: 180, elapsed: 0,
            artworkUrl: "https://lh3.googleusercontent.com/x=w60-h60-l90-rj")))
  }

  @Test func artworkComesOnlyFromYouTubeImageHosts() {
    #expect(
      NowPlaying.artworkURL("https://lh3.googleusercontent.com/abc=w60-h60-l90-rj")?.absoluteString
        == "https://lh3.googleusercontent.com/abc=w544-h544")
    #expect(NowPlaying.artworkURL("https://i.ytimg.com/vi/a/sddefault.jpg")?.absoluteString == "https://i.ytimg.com/vi/a/sddefault.jpg")
    #expect(NowPlaying.artworkURL("http://i.ytimg.com/vi/a/sddefault.jpg") == nil)
    #expect(NowPlaying.artworkURL("https://evil.example/x.jpg") == nil)
    #expect(NowPlaying.artworkURL("https://notytimg.com/x.jpg") == nil)
    #expect(NowPlaying.artworkURL("file:///etc/passwd") == nil)
  }

  @Test func debounceDropsTheSecondDeliveryOfOnePress() {
    var debounce = NowPlaying.Debounce()
    let start = ContinuousClock.now
    let admitted = [
      (NowPlaying.Command.pause, 0), (.toggle, 50), (.next, 60), (.next, 100), (.play, 400), (.seek(10), 401),
      (.seek(20), 402),
    ].map { debounce.admit($0, at: start + .milliseconds($1)) }
    // The toggle is the same press as the pause via the other route.
    #expect(admitted == [true, false, true, false, true, true, true])
  }

}
