// Every message between the UI and the Swift shell. Sources/Melo/Protocol.swift mirrors this file with the same
// names and fields, and the two change together.

/** Requests from the UI, answered by Swift. Posted as `{ method, params }`. */
export interface Requests {
  ping: { params: { sentAt: number }; result: { receivedAt: number } }
  // Sign-in and InnerTube.
  'auth.status': { params: Record<string, never>; result: AuthStatus }
  /** Opens the login window and resolves when sign-in completes or the window is closed. */
  'auth.signIn': { params: Record<string, never>; result: AuthStatus }
  /** Clears the Keychain backup and the YouTube and Google cookies. */
  'auth.signOut': { params: Record<string, never>; result: AuthStatus }
  /** Posts to /youtubei/v1/<endpoint> and resolves with the raw InnerTube JSON. Swift adds the context. */
  'api.call': { params: { endpoint: Endpoint; body: Record<string, unknown> }; result: ApiResult }
  // Player: the hidden YouTube Music player. Every request resolves with null.
  'player.play': { params: Record<string, never>; result: null }
  'player.pause': { params: Record<string, never>; result: null }
  'player.toggle': { params: Record<string, never>; result: null }
  'player.seek': { params: { seconds: number }; result: null }
  /** `volume` runs from 0 to 1. */
  'player.setVolume': { params: { volume: number }; result: null }
  /** Plays a track. The web player never advances on its own: when `player.state` reports `ended`, load the next one. */
  'player.load': { params: LoadParams; result: null }
  /** The latest state, for a page that has just loaded (after a reload, say); `player.state` carries every change. */
  'player.get': { params: Record<string, never>; result: PlayerState }
  // Queue: Melo's own queue, which lives in Swift so it keeps going while the window is hidden. Every request except
  // `queue.get` resolves with null; `queue.changed` carries the new snapshot. Bad indexes reject.
  'queue.get': { params: Record<string, never>; result: QueueSnapshot }
  /** Replaces the queue and plays `items[index]`. `continuation` is the radio's, when the items are a radio's first page. */
  'queue.set': { params: { items: QueueItem[]; index: number; source?: QueueSource; continuation?: string }; result: null }
  /** Inserts after the current entry. Plays at once on an empty queue, as does `queue.add`. */
  'queue.playNext': { params: { item: QueueItem }; result: null }
  'queue.add': { params: { item: QueueItem }; result: null }
  'queue.remove': { params: { index: number }; result: null }
  'queue.move': { params: { from: number; to: number }; result: null }
  'queue.next': { params: Record<string, never>; result: null }
  /** Restarts the track after its first 3 s, otherwise plays the entry before it. */
  'queue.previous': { params: Record<string, never>; result: null }
  'queue.jump': { params: { index: number }; result: null }
  'queue.setShuffle': { params: { enabled: boolean }; result: null }
  'queue.setRepeat': { params: { mode: RepeatMode }; result: null }
  'queue.setAutoplay': { params: { enabled: boolean }; result: null }
  /** Radio songs answering `queue.needsMore`. Swift skips songs already queued, and drops the call if `after` is stale. */
  'queue.append': { params: { items: QueueItem[]; continuation?: string; after: number }; result: null }
  // Settings, lyrics, and the menu bar and mini player pages.
  'settings.get': { params: Record<string, never>; result: Settings }
  /** Changes only the given fields and resolves with the new settings, which `settings.changed` also carries. */
  'settings.set': { params: Partial<Settings>; result: Settings }
  /** Searches lrclib.net from Swift. Instrumentals and empty entries are dropped; any failure resolves with []. */
  'lyrics.lrclib': { params: { title: string; artist: string; durationSec: number }; result: LrclibResult[] }
  /** Brings the main window forward. */
  'app.showWindow': { params: Record<string, never>; result: null }
  'app.quit': { params: Record<string, never>; result: null }
  /** Puts the song's music.youtube.com link on the clipboard. Swift builds the URL from the id. */
  'app.copyLink': { params: { videoId: string }; result: null }
  // Library: like, save and subscribe state shared by every page.
  /** Swift sends it straight back to every page, the sender included, as `library.changed`. */
  'library.broadcast': { params: LibraryChange; result: null }
  // Back and forward: the buttons are native, in the title bar; the history lives here.
  'nav.state': { params: { canGoBack: boolean; canGoForward: boolean }; result: null }
}

/** Events pushed by Swift. Delivered as `{ name, payload }`. */
export interface Events {
  'auth.changed': AuthStatus
  'player.state': PlayerState // Player
  // Queue
  'queue.changed': QueueSnapshot
  /** Autoplay wants more radio: see `NeedsMore`. */
  'queue.needsMore': NeedsMore
  /** A track could not be played. `skipped` is false when too many failed in a row and the queue stopped instead. */
  'queue.unplayable': { videoId: string; title: string; skipped: boolean }
  'settings.changed': Settings
  'library.changed': LibraryChange // Library
  /** A title bar button was clicked. */
  'nav.go': { direction: 'back' | 'forward' }
}

export type Method = keyof Requests
export type EventName = keyof Events
export type Request = { [M in Method]: { method: M; params: Requests[M]['params'] } }[Method]
export type Event = { [N in EventName]: { name: N; payload: Events[N] } }[EventName]

// Sign-in and InnerTube.

/** `expired` means a signed-in call was refused with 401 or 403: offer to sign in again. Nothing was deleted. */
export interface AuthStatus {
  signedIn: boolean
  expired: boolean
}

/** The endpoints Swift allows. Any other endpoint rejects the request. */
export type Endpoint =
  | 'browse'
  | 'search'
  | 'music/get_search_suggestions'
  | 'next'
  | 'like/like'
  | 'like/dislike'
  | 'like/removelike'
  | 'playlist/create'
  | 'playlist/get_add_to_playlist'
  | 'browse/edit_playlist'
  | 'feedback'
  | 'subscription/subscribe'
  | 'subscription/unsubscribe'
  | 'account/account_menu'

export interface ApiError {
  kind: 'auth' | 'network' | 'http' | 'parse'
  status?: number
}

export type ApiResult = { ok: true; json: unknown } | { ok: false; error: ApiError }

// Player: the hidden YouTube Music player.

/** Ids are letters, digits, `_` and `-`; anything else rejects the request. */
export interface LoadParams {
  videoId: string
  playlistId?: string
  index?: number
}

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error'

/**
 * Sent on every status or track change, and at most four times a second while only the clock moves.
 * Metadata is what the page reports, and is absent until the requested track's media has loaded.
 */
export interface PlayerState {
  status: PlayerStatus
  videoId?: string
  title?: string
  artist?: string
  album?: string
  artworkUrl?: string
  currentTime: number
  duration: number
  volume: number
  isAd: boolean
  error?: string
}

// Queue: Melo's own queue, which lives in Swift.

/** A track as the UI shows it. Swift only reads `videoId`, which must be a YouTube id; the rest it hands back. */
export interface QueueItem {
  videoId: string
  title: string
  artists: { name: string; browseId?: string }[]
  album?: { name: string; browseId: string }
  durationSec?: number
  thumbnailUrl?: string
  isVideo?: boolean
}

/** Where the queue came from, shown as "Playing from". */
export interface QueueSource {
  title: string
  browseId?: string
}

export type RepeatMode = 'off' | 'all' | 'one'

/** `index` is -1 when the queue is empty. Entries before it have played; entries after it are up next. */
export interface QueueSnapshot {
  /** `id` is unique within the queue, so the same song can be queued twice. */
  items: { id: number; item: QueueItem }[]
  index: number
  source?: QueueSource
  shuffle: boolean
  repeat: RepeatMode
  autoplay: boolean
}

/**
 * Fetch `next` with `continuation` if given, otherwise the radio for `videoId`, and send the songs with
 * `queue.append`, echoing `after` (the id of the last queued entry).
 */
export interface NeedsMore {
  videoId: string
  continuation?: string
  after: number
}

// Settings and lyrics.

export type Theme = 'system' | 'light' | 'dark'

/** Saved by Swift in UserDefaults. Autoplay is not here: it belongs to the queue. */
export interface Settings {
  theme: Theme
  lyricsFromLrclib: boolean
  menuBarItem: boolean
  miniPlayer: boolean
  mediaKeys: boolean
}

/** One LRCLIB result, trimmed by Swift to these fields. `syncedLyrics` is LRC text. */
export interface LrclibResult {
  durationSec: number
  plainLyrics?: string
  syncedLyrics?: string
}

// Library: like, save and subscribe state shared by every page.

/**
 * One known state, keyed as in `library.ts`: `song:<videoId>`, `list:<playlistId>`, `artist:<channelId>` or
 * `row:<playlistId>:<setVideoId>`. `value` is a like status, a flag, or null to forget the key. Swift rejects other keys.
 */
export interface LibraryChange {
  key: string
  value: 'LIKE' | 'DISLIKE' | 'INDIFFERENT' | boolean | null
}
