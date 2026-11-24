// Queue contract. Screens only use these exports. The queue itself lives in Swift (Sources/Melo/Queue.swift), so it
// keeps advancing and answering media keys while the window is hidden; this module sends it `queue.*` requests and
// renders its `queue.changed` snapshots.
//
// - playSongs(songs, startIndex, source): replace the queue and play songs[startIndex].
// - playNext(song): insert after the current song. addToQueue(song): append. Either plays at once on an empty queue.
// - startRadio(videoId): replace the queue with that song's radio.
// - next() / previous(): move through the queue and play. Previous restarts the song after its first 3 s.
// - jump(index), remove(index), move(from, to): act on an entry by its index in the whole queue.
// - toggleShuffle() / cycleRepeat() / setAutoplay(on): the queue's modes.
// - useQueue(): { current, index, upNext, source, shuffle, repeat, autoplay } for the player bar and the Up next panel.
//   upNext[i] sits at index + 1 + i in the whole queue.
//
// Autoplay radio is fetched here, when Swift sends `queue.needsMore`, because parsing stays in TypeScript.
import { call } from '../api/call'
import type { Song } from '../api/models'
import { parseWatchNext, parseWatchNextContinuation } from '../api/parse/watch'
import { nextContinuation, radio } from '../api/requests'
import { on, request } from '../bridge/client'
import type { NeedsMore, QueueItem, QueueSnapshot, QueueSource as SourceMessage, RepeatMode } from '../bridge/protocol'
import { artUrl } from '../images'
import type { Route } from '../nav/history'
import { createStore, useStore } from '../store'
import { toast } from '../toasts'

/** Where the queue came from, for "Playing from". `route` links back to it. */
export interface QueueSource {
  label: string
  route?: Route
}

export type Repeat = RepeatMode

export interface QueueView {
  current?: Song
  /** The current song's index in the whole queue, -1 when empty. */
  index: number
  upNext: Song[]
  /** Entry ids, parallel to `upNext`, for stable list keys. */
  upNextIds: number[]
  source?: QueueSource
  shuffle: boolean
  repeat: Repeat
  autoplay: boolean
}

// The full songs the UI queued, so rows keep their like status, explicit badge and every thumbnail size. A queue
// restored at launch has only what Swift saved, and falls back to `toSong`.
const known = new Map<string, Song>()

function remember(songs: Song[]) {
  for (const song of songs) known.set(song.videoId, song)
}

export function toItem(song: Song): QueueItem {
  const item: QueueItem = { videoId: song.videoId, title: song.title, artists: song.artists, isVideo: song.isVideo }
  if (song.album) item.album = song.album
  if (song.durationSec !== undefined) item.durationSec = song.durationSec
  const thumbnailUrl = artUrl(song.thumbnails, 272)
  if (thumbnailUrl) item.thumbnailUrl = thumbnailUrl
  return item
}

export function toSong(item: QueueItem): Song {
  return (
    known.get(item.videoId) ?? {
      kind: 'song',
      videoId: item.videoId,
      title: item.title,
      artists: item.artists,
      album: item.album,
      durationSec: item.durationSec,
      thumbnails: item.thumbnailUrl ? [{ url: item.thumbnailUrl }] : [],
      explicit: false,
      isVideo: item.isVideo ?? false,
      playable: true,
    }
  )
}

/** Swift keeps the source as a title and browse id; the route kind follows from the id's prefix. */
function toMessage(source?: QueueSource): SourceMessage | undefined {
  if (!source) return undefined
  const route = source.route
  const browseId = route && 'browseId' in route ? route.browseId : undefined
  return browseId ? { title: source.label, browseId } : { title: source.label }
}

function fromMessage(source?: SourceMessage): QueueSource | undefined {
  if (!source) return undefined
  const id = source.browseId
  if (!id) return { label: source.title }
  const name = id.startsWith('MPRE') ? 'album' : id.startsWith('UC') ? 'artist' : 'playlist'
  return { label: source.title, route: { name, browseId: id } }
}

export function view(snapshot: QueueSnapshot): QueueView {
  const after = snapshot.items.slice(snapshot.index + 1)
  const current = snapshot.items[snapshot.index]
  return {
    current: current && toSong(current.item),
    index: snapshot.index,
    upNext: after.map((entry) => toSong(entry.item)),
    upNextIds: after.map((entry) => entry.id),
    source: fromMessage(snapshot.source),
    shuffle: snapshot.shuffle,
    repeat: snapshot.repeat,
    autoplay: snapshot.autoplay,
  }
}

const queue = createStore<QueueView>({ index: -1, upNext: [], upNextIds: [], shuffle: false, repeat: 'off', autoplay: true })

on('queue.changed', (snapshot) => queue.set(view(snapshot)))
on('queue.unplayable', ({ title, skipped }) => toast(skipped ? `${title} can't be played here, so it was skipped.` : `${title} can't be played here.`))
on('queue.needsMore', (more) => void fetchMore(more))
// The queue may already hold songs, restored at launch or queued before this page loaded.
request('queue.get', {}).then(
  (snapshot) => queue.set(view(snapshot)),
  () => {},
)

/** Fetches the next page of radio for autoplay. A failure is dropped: Swift asks again the next time the UI loads. */
export async function fetchMore(more: NeedsMore) {
  try {
    const page = more.continuation
      ? parseWatchNextContinuation(await call(nextContinuation(more.continuation)))
      : parseWatchNext(await call(radio(more.videoId)))
    const songs = page.items.filter((song) => song.playable)
    remember(songs)
    await request('queue.append', { items: songs.map(toItem), continuation: page.continuation, after: more.after })
  } catch (error) {
    console.warn('Autoplay radio failed', error)
  }
}

export function playSongs(songs: Song[], startIndex: number, source?: QueueSource) {
  remember(songs)
  void request('queue.set', { items: songs.map(toItem), index: startIndex, source: toMessage(source) })
}

export function playNext(song: Song) {
  remember([song])
  void request('queue.playNext', { item: toItem(song) })
}

export function addToQueue(song: Song) {
  remember([song])
  void request('queue.add', { item: toItem(song) })
}

export async function startRadio(videoId: string) {
  const watch = parseWatchNext(await call(radio(videoId)))
  const songs = watch.items.filter((song) => song.playable)
  if (songs.length === 0) return
  remember(songs)
  await request('queue.set', { items: songs.map(toItem), index: 0, source: { title: 'Radio' }, continuation: watch.continuation })
}

export const next = () => void request('queue.next', {})
export const previous = () => void request('queue.previous', {})
export const jump = (index: number) => void request('queue.jump', { index })
export const remove = (index: number) => void request('queue.remove', { index })
export const move = (from: number, to: number) => void request('queue.move', { from, to })
export const toggleShuffle = () => void request('queue.setShuffle', { enabled: !queue.get().shuffle })
export const setAutoplay = (enabled: boolean) => void request('queue.setAutoplay', { enabled })

export function cycleRepeat() {
  const order: Repeat[] = ['off', 'all', 'one']
  void request('queue.setRepeat', { mode: order[(order.indexOf(queue.get().repeat) + 1) % order.length] })
}

export const useQueue = () => useStore(queue)
