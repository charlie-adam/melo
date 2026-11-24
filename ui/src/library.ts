// Library state shared by every screen: the rail's playlists, the latest known like, save and subscribe state, and
// pending changes the server has not caught up with yet.
//
// The backend is eventually consistent after a mutation, so a list fetched straight after a save can still lack the
// item. Each mutation records what it expects a library list to show, and screens pass their lists through
// `reconcile`, which applies it. A re-fetch 500 ms after the call settles each expectation once the server agrees;
// if the server still disagrees after three tries, the expectation is dropped and the server's list stands.
// Settled expectations stay, because screens may still hold a list fetched before the change.
// Kaset does the same in LibraryContentReconciler.swift, with more cases.
import { call } from './api/call'
import type { Item, LikeStatus, Playlist } from './api/models'
import { parsePlaylistPage } from './api/parse/collection'
import { parseLibrary } from './api/parse/library'
import { libraryAlbums, libraryPlaylists, likedSongs } from './api/requests'
import { on, request } from './bridge/client'
import { createStore, useStore } from './store'

const playlists = createStore<Playlist[]>([])

/** Loads the first page of library playlists for the rail and the add-to-playlist menu. Call again after a change. */
export async function refreshLibraryPlaylists() {
  playlists.set((await fetchList('playlists')) as Playlist[])
}

export const useLibraryPlaylists = () => useReconciled('playlists', useStore(playlists))

// Latest known state, keyed `song:<videoId>`, `list:<playlistId>`, `artist:<channelId>` or `row:<playlistId>:<setVideoId>`.
// It outlives the mutation, so a screen holding an older response still shows the change. Each change goes through
// Swift as `library.broadcast` and comes back to every page as `library.changed`, so a like in the menu bar panel or
// the mini player shows in the main window too.

export type Known = LikeStatus | boolean

const known = createStore<ReadonlyMap<string, Known>>(new Map())

export const recall = (key: string): Known | undefined => known.get().get(key)

function apply(key: string, value: Known | undefined) {
  const next = new Map(known.get())
  if (value === undefined) next.delete(key)
  else next.set(key, value)
  known.set(next)
}

export function remember(key: string, value: Known | undefined) {
  apply(key, value)
  // Outside the app (tests) there is no Swift to pass it on; this page already has it.
  request('library.broadcast', { key, value: value ?? null }).catch(() => {})
}

on('library.changed', ({ key, value }) => apply(key, value ?? undefined))

export const useKnownMap = () => useStore(known)

export function useKnown<T extends Known>(key: string | undefined, fallback: T): T {
  const map = useKnownMap()
  return key === undefined ? fallback : ((map.get(key) as T | undefined) ?? fallback)
}

// Pending list membership.

export type ListName = 'playlists' | 'albums' | 'songs'

interface Expectation {
  list: ListName
  id: string
  present: boolean
  /** Shown at the top of the list while the server lacks it. */
  item?: Item
  /** Set once the mutation succeeded; only then do re-fetches check it. Later checks get higher numbers. */
  armed?: number
  checks: number
  /** A re-fetch agreed. */
  settled?: boolean
}

/** First check after 500 ms, then 1 s and 2 s; after the third disagreement the server's list stands. */
export const RECHECK_MS = [500, 1000, 2000]

const pending = createStore<Expectation[]>([])
const timers = new Map<ListName, ReturnType<typeof setTimeout>>()
let armedCount = 0

export function itemId(item: Item): string {
  if (item.kind === 'song') return item.videoId
  if (item.kind === 'playlist') return item.playlistId
  return item.browseId
}

const same = (e: Expectation, list: ListName, id: string) => e.list === list && e.id === id

/** Records, before the mutation is sent, that `list` should (or should not) contain `id`. */
export function expectInList(list: ListName, id: string, present: boolean, item?: Item) {
  pending.set([...pending.get().filter((e) => !same(e, list, id)), { list, id, present, item, checks: 0 }])
}

/** Call when the mutation succeeded: schedules a re-fetch of `list` to confirm it. */
export function confirmExpectation(list: ListName, id: string) {
  const armed = ++armedCount
  pending.set(pending.get().map((e) => (same(e, list, id) ? { ...e, armed } : e)))
  schedule(list)
}

/** Call when the mutation failed. */
export function forgetExpectation(list: ListName, id: string) {
  pending.set(pending.get().filter((e) => !same(e, list, id)))
}

/** `items` with pending removals hidden and pending additions the server lacks shown first. */
export function reconcile<T extends Item>(list: ListName | undefined, items: T[], expectations = pending.get()): T[] {
  const mine = expectations.filter((e) => e.list === list)
  if (mine.length === 0) return items
  const hidden = new Set(mine.filter((e) => !e.present).map((e) => e.id))
  const kept = items.filter((i) => !hidden.has(itemId(i)))
  const ids = new Set(kept.map(itemId))
  const added = mine.filter((e) => e.present && e.item && !ids.has(e.id)).map((e) => e.item as T)
  // Liked music (LM) stays first in the rail, above anything added since the last fetch.
  const liked = kept.filter((i) => itemId(i) === 'LM')
  return [...liked, ...added.reverse(), ...kept.filter((i) => itemId(i) !== 'LM')]
}

export function useReconciled<T extends Item>(list: ListName | undefined, items: T[]): T[] {
  return reconcile(list, items, useStore(pending))
}

async function fetchList(list: ListName): Promise<Item[]> {
  if (list === 'songs') return parsePlaylistPage(await call(likedSongs()), 'VLLM').tracks
  const page = parseLibrary(await call(list === 'playlists' ? libraryPlaylists() : libraryAlbums()))
  return page.items.filter((i) => i.kind === (list === 'playlists' ? 'playlist' : 'album'))
}

function schedule(list: ListName) {
  clearTimeout(timers.get(list))
  timers.delete(list)
  const due = pending.get().filter((e) => e.list === list && e.armed !== undefined && !e.settled)
  if (due.length === 0) return
  const checks = Math.min(...due.map((e) => e.checks))
  timers.set(list, setTimeout(() => void check(list), RECHECK_MS[checks]))
}

/**
 * Re-fetches the first page of `list` and settles the expectations it agrees with.
 * Only the first page is read: a recent like or save sits at its top, and an unlike counts as agreed once the song
 * is off that page.
 */
async function check(list: ListName) {
  timers.delete(list)
  // Expectations armed while the fetch is in flight wait for the next one.
  const upTo = armedCount
  let ids: Set<string> | undefined
  try {
    const items = await fetchList(list)
    if (list === 'playlists') playlists.set(items as Playlist[])
    ids = new Set(items.map(itemId))
  } catch {
    // A failed re-fetch says nothing about the server, so it only uses up a check.
  }
  const due = (e: Expectation) => e.list === list && e.armed !== undefined && e.armed <= upTo && !e.settled
  const agrees = (e: Expectation) => ids !== undefined && ids.has(e.id) === e.present
  pending.set(
    pending
      .get()
      .map((e) => (!due(e) ? e : agrees(e) ? { ...e, settled: true } : { ...e, checks: e.checks + 1 }))
      .filter((e) => e.checks < RECHECK_MS.length),
  )
  schedule(list)
}

/** Clears all state. Tests only. */
export function resetLibraryState() {
  for (const t of timers.values()) clearTimeout(t)
  timers.clear()
  pending.set([])
  known.set(new Map())
  armedCount = 0
  playlists.set([])
}
