// Pure helpers for player.js, with no DOM access.
// Player.swift injects this file and player.js inside one function scope, and ui/src/player-script/core.test.ts runs
// this file on its own.
const PlayerCore = {
  /** Melo's document generation, from the `meloGeneration` query item or fragment, or -1. */
  generation(href) {
    const url = new URL(href)
    const raw = url.searchParams.get('meloGeneration') ?? new URLSearchParams(url.hash.slice(1)).get('meloGeneration')
    const value = raw === null || raw === '' ? NaN : Number(raw)
    return Number.isSafeInteger(value) && value >= 0 ? value : -1
  },

  /** One of idle, loading, playing, paused, ended or error. */
  status({ expected, fresh, ended, error, paused, readyState }) {
    if (error) return 'error'
    if (!expected) return 'idle'
    if (ended) return 'ended'
    if (!fresh) return 'loading'
    if (paused) return 'paused'
    return readyState >= 3 ? 'playing' : 'loading'
  },

  /** Whether the page may play: only the track Melo asked for (or its ad), and never while held. */
  mayPlay({ hold, expected, isAd, pageVideoId }) {
    return !hold && !!expected && (isAd || pageVideoId === expected)
  },

  /**
   * How long Melo's next load must wait after a track's end. YouTube Music loads its own next track within about
   * 150 ms of an end, and a router load sent inside that window can be replaced by it, dropping Melo's track back to
   * loading about 2 s after it starts.
   */
  settleWait(advanceUntil, now) {
    return Math.max(0, advanceUntil - now)
  },

  /**
   * How Play reaches Melo's track: 'settle' waits out YouTube Music's own post-end load and comes back to the track,
   * 'bind' waits until the page's media is bound to the track, and 'now' plays at once. Regression: Previous after the
   * end of the queue played while the end-of-queue route was still loading the track, and the page stuck at loading.
   */
  playPath({ expected, settling, onTrack, fresh }) {
    if (expected && (settling || !onTrack)) return 'settle'
    if (expected && !fresh) return 'bind'
    return 'now'
  },

  /** Whether to bring the page back to an ended track once YouTube Music has loaded its own next one over it. */
  needsEndCleanup({ ended, cleaned, settling, pageVideoId, expected }) {
    return ended && !cleaned && !settling && !!expected && !!pageVideoId && pageVideoId !== expected
  },

  /** Sends anything but the clock at once, and clock-only changes at most once per `intervalMs`. */
  shouldSend(previous, next, msSinceLast, intervalMs) {
    if (!previous) return true
    for (const key of Object.keys(next)) {
      if (key !== 'currentTime' && previous[key] !== next[key]) return true
    }
    return previous.currentTime !== next.currentTime && msSinceLast >= intervalMs
  },

  /** The largest image in a MediaMetadata artwork list, or null. */
  artwork(list) {
    let best = null
    let bestSize = -1
    for (const image of list ?? []) {
      const size = Number.parseInt(String(image.sizes ?? '').split('x')[0], 10) || 0
      if (image.src && size > bestSize) {
        best = image.src
        bestSize = size
      }
    }
    return best
  },

  /** Artist and album from a player-bar byline: songs read "Artist • Album • 2019", videos "Artist • 1M views". */
  byline(text) {
    const parts = String(text ?? '').split('•').map((part) => part.trim()).filter(Boolean)
    const hasAlbum = parts.length >= 3 && /^\d{4}$/.test(parts[parts.length - 1])
    return { artist: parts[0] ?? null, album: hasAlbum ? parts[1] : null }
  },
}
