// Dev only: stands in for the Swift shell when Vite runs in a plain browser, so screens render from the committed
// fixtures. main.tsx imports this behind import.meta.env.DEV, so production builds never include it.
import { fixture } from '../api/fixture'
import { parseHome } from '../api/parse/home'
import { parseLibrary } from '../api/parse/library'
import { parsePlaylistPage } from '../api/parse/collection'
import { parseSearch } from '../api/parse/search'
import { parseWatchNext } from '../api/parse/watch'
import type { LrclibResult, PlayerState, QueueItem, QueueSnapshot, Request, Settings } from '../bridge/protocol'
import { artUrl } from '../images'
import art1 from './placeholders/art-1.svg?no-inline'
import art2 from './placeholders/art-2.svg?no-inline'
import art3 from './placeholders/art-3.svg?no-inline'
import art4 from './placeholders/art-4.svg?no-inline'
import avatar from './placeholders/avatar.svg?no-inline'

const SEARCH_FIXTURES: Record<string, string> = {
  Songs: 'search-songs',
  Videos: 'search-videos',
  Albums: 'search-albums',
  Artists: 'search-artists',
  Playlists: 'search-playlists',
  'Community playlists': 'search-community-playlists',
  'Featured playlists': 'search-featured-playlists',
  Profiles: 'search-profiles',
}
// Each results page carries its own chip params, so every page's chips are mapped, not only the first page's.
const searchByParams = new Map(
  ['search-all', ...Object.values(SEARCH_FIXTURES)].flatMap((name) => parseSearch(fixture(name)).filters.map((f) => [f.params, SEARCH_FIXTURES[f.label]] as const)),
)

// Each continuation fixture answers the token of the page it follows.
const continuations = new Map<string | undefined, string>([
  [parseHome(fixture('home')).continuation, 'home-continuation'],
  [parsePlaylistPage(fixture('playlist'), 'VL').continuation, 'playlist-continuation'],
  [parseSearch(fixture('search-songs')).continuation, 'search-songs-continuation'],
  [parseLibrary(fixture('synthetic-library-albums')).continuation, 'synthetic-library-albums-continuation'],
  [parseWatchNext(fixture('next-radio')).continuation, 'next-radio-continuation'],
])

function browseFixture(id: string): string | undefined {
  if (id === 'FEmusic_home') return 'home'
  if (id === 'FEmusic_liked_playlists') return 'synthetic-library-playlists'
  if (id === 'FEmusic_liked_albums') return 'synthetic-library-albums'
  if (id === 'FEmusic_library_corpus_artists') return 'synthetic-library-artists'
  if (id === 'VLLM') return 'synthetic-liked-songs'
  if (id.startsWith('MPLYt')) return 'lyrics'
  if (id.startsWith('MPRE')) return 'album'
  if (id.startsWith('UC')) return 'artist'
  if (id.startsWith('VL') || id.startsWith('RD')) return 'playlist'
  return undefined
}

function apiFixture(endpoint: string, body: Record<string, unknown>): string | undefined {
  if (typeof body.continuation === 'string') return continuations.get(body.continuation)
  if (endpoint === 'browse') return browseFixture(String(body.browseId))
  if (endpoint === 'search') return body.params ? searchByParams.get(String(body.params)) : 'search-all'
  if (endpoint === 'music/get_search_suggestions') return 'suggestions'
  if (endpoint === 'next') return body.playlistId ? 'next-radio' : 'next'
  if (endpoint === 'account/account_menu') return 'synthetic-account-menu'
  if (endpoint === 'playlist/get_add_to_playlist') return 'synthetic-add-to-playlist'
  return undefined
}

// Synthetic fixtures point at made-up image URLs, which Google answers with 400. In the preview they become local
// placeholders, served by Vite and never part of the production build.
const ART = [art1, art2, art3, art4]
function withPlaceholders(json: unknown): unknown {
  let n = 0
  const text = JSON.stringify(json).replace(/https:\/\/(lh3\.googleusercontent\.com|yt3\.ggpht\.com)\/synthetic[^"]*/g, (url) =>
    url.includes('account-photo') ? avatar : ART[n++ % ART.length],
  )
  return JSON.parse(text)
}

let created = 0

/** Mutations succeed with the response shapes the parsers read. Nothing is stored, so lists do not change. */
function mutationResponse(endpoint: string, body: Record<string, unknown>): unknown {
  if (endpoint === 'playlist/create') return { status: 'STATUS_SUCCEEDED', playlistId: `PLdevcreated${++created}` }
  if (endpoint === 'browse/edit_playlist') {
    const [action] = body.actions as { addedVideoId?: string }[]
    const added = action?.addedVideoId ? [{ playlistEditVideoAddedResultData: { videoId: action.addedVideoId, setVideoId: `devset${Date.now()}` } }] : []
    return { status: 'STATUS_SUCCEEDED', playlistEditResults: added }
  }
  if (/^(like\/|subscription\/|feedback$)/.test(endpoint)) return {}
  return undefined
}

let state: PlayerState = { status: 'idle', currentTime: 0, duration: 0, volume: 1, isAd: false }
function emit(next: Partial<PlayerState>) {
  state = { ...state, ...next }
  window.melo?.emit({ name: 'player.state', payload: state })
}
setInterval(() => {
  if (state.status === 'playing') emit({ currentTime: Math.min(state.currentTime + 1, state.duration) })
}, 1000)

// A small stand-in for Swift's queue: enough to render and drive the Up next panel and the player bar.
let queue: QueueSnapshot = { items: [], index: -1, shuffle: false, repeat: 'off', autoplay: true }
let nextId = 0
const entries = (items: QueueItem[]) => items.map((item) => ({ id: nextId++, item }))
function setQueue(next: Partial<QueueSnapshot>, play = false) {
  queue = { ...queue, ...next }
  window.melo?.emit({ name: 'queue.changed', payload: queue })
  const current = queue.items[queue.index]
  if (play && current) emit({ status: 'playing', videoId: current.item.videoId, currentTime: 0, duration: current.item.durationSec ?? 240 })
}

// Settings kept in memory, and a synthetic LRCLIB answer with placeholder lines timed across the track.
let settings: Settings = { theme: 'system', lyricsFromLrclib: true, menuBarItem: true, miniPlayer: false, mediaKeys: true }

function lrclib(durationSec: number): LrclibResult[] {
  const stamp = (t: number) => `[${String(Math.floor(t / 60)).padStart(2, '0')}:${(t % 60).toFixed(2).padStart(5, '0')}]`
  const lines = Array.from({ length: 40 }, (_, i) => {
    const text = i % 9 === 8 ? '' : i % 7 === 3 ? `Placeholder line ${i + 1}, long enough to wrap onto a second row` : `Placeholder line ${i + 1}`
    return `${stamp(8 + i * 5)} ${text}`
  })
  return [
    { durationSec: durationSec + 30, plainLyrics: 'Placeholder for another recording' },
    { durationSec, plainLyrics: lines.map((l) => l.replace(/^\[[^\]]+\] ?/, '')).join('\n'), syncedLyrics: lines.join('\n') },
  ]
}

// The menu bar and mini player pages get their own bridge, so they start with a queue already playing.
if (location.hash === '#menubar' || location.hash === '#mini') {
  const songs = parseWatchNext(fixture('next-radio')).items.slice(0, 2)
  const items: QueueItem[] = songs.map((s) => ({ videoId: s.videoId, title: s.title, artists: s.artists, album: s.album, durationSec: s.durationSec, thumbnailUrl: artUrl(s.thumbnails, 272) }))
  queue = { ...queue, items: entries(items), index: 0 }
  state = { ...state, status: 'playing', videoId: items[0].videoId, currentTime: 72, duration: items[0].durationSec ?? 228 }
}

async function answer(message: Request): Promise<unknown> {
  await new Promise((resolve) => setTimeout(resolve, 150))
  switch (message.method) {
    case 'auth.status':
    case 'auth.signIn':
      return { signedIn: true, expired: false }
    case 'auth.signOut':
      return { signedIn: false, expired: false }
    case 'api.call': {
      const mutation = mutationResponse(message.params.endpoint, message.params.body)
      if (mutation) return { ok: true, json: mutation }
      const name = apiFixture(message.params.endpoint, message.params.body)
      // An unknown continuation ends the list, as an exhausted feed does.
      if (!name) return typeof message.params.body.continuation === 'string' ? { ok: true, json: {} } : { ok: false, error: { kind: 'http', status: 404 } }
      return { ok: true, json: name.startsWith('synthetic-') ? withPlaceholders(fixture(name)) : fixture(name) }
    }
    case 'player.load':
      emit({ status: 'playing', videoId: message.params.videoId, currentTime: 0, duration: 240 })
      return null
    case 'player.get':
      return state
    case 'player.play':
      emit({ status: 'playing' })
      return null
    case 'player.pause':
      emit({ status: 'paused' })
      return null
    case 'player.toggle':
      emit({ status: state.status === 'playing' ? 'paused' : 'playing' })
      return null
    case 'player.seek':
      emit({ currentTime: message.params.seconds })
      return null
    case 'player.setVolume':
      emit({ volume: message.params.volume })
      return null
    case 'ping':
      return { receivedAt: Date.now() }
    case 'queue.get':
      return queue
    case 'queue.set':
      setQueue({ items: entries(message.params.items), index: message.params.index, source: message.params.source }, true)
      return null
    case 'queue.playNext':
    case 'queue.add': {
      const [entry] = entries([message.params.item])
      const at = message.method === 'queue.add' ? queue.items.length : queue.index + 1
      setQueue({ items: [...queue.items.slice(0, at), entry, ...queue.items.slice(at)], index: Math.max(queue.index, 0) }, queue.index < 0)
      return null
    }
    case 'queue.append':
      setQueue({ items: [...queue.items, ...entries(message.params.items)] })
      return null
    case 'queue.remove': {
      const i = message.params.index
      setQueue({ items: queue.items.filter((_, j) => j !== i), index: i < queue.index ? queue.index - 1 : queue.index }, i === queue.index)
      return null
    }
    case 'queue.move': {
      const items = [...queue.items]
      const currentId = items[queue.index]?.id
      const [moved] = items.splice(message.params.from, 1)
      items.splice(message.params.to, 0, moved)
      setQueue({ items, index: items.findIndex((e) => e.id === currentId) })
      return null
    }
    case 'queue.jump':
      setQueue({ index: message.params.index }, true)
      return null
    case 'queue.next':
      if (queue.index < queue.items.length - 1) setQueue({ index: queue.index + 1 }, true)
      return null
    case 'queue.previous':
      if (queue.index > 0) setQueue({ index: queue.index - 1 }, true)
      return null
    case 'queue.setShuffle':
      setQueue({ shuffle: message.params.enabled })
      return null
    case 'queue.setRepeat':
      setQueue({ repeat: message.params.mode })
      return null
    case 'queue.setAutoplay':
      setQueue({ autoplay: message.params.enabled })
      return null
    case 'settings.get':
      return settings
    case 'settings.set':
      settings = { ...settings, ...message.params }
      window.melo?.emit({ name: 'settings.changed', payload: settings })
      return settings
    case 'lyrics.lrclib':
      return lrclib(message.params.durationSec)
    case 'app.showWindow':
    case 'app.quit':
    case 'app.copyLink':
    case 'nav.state':
      return null
    case 'library.broadcast':
      window.melo?.emit({ name: 'library.changed', payload: message.params })
      return null
  }
}

window.webkit = { messageHandlers: { melo: { postMessage: answer } } }
