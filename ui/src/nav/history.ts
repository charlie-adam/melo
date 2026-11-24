import { createStore, useStore } from '../store'

export type LibraryTab = 'playlists' | 'albums' | 'artists' | 'songs'

export type Route =
  | { name: 'home' }
  | { name: 'search'; query: string; params?: string }
  | { name: 'album'; browseId: string }
  | { name: 'playlist'; browseId: string }
  | { name: 'artist'; browseId: string }
  | { name: 'library'; tab: LibraryTab }

/** In-app back and forward, like a browser: pushing drops everything after the current entry. */
export interface History {
  entries: Route[]
  index: number
}

const same = (a: Route, b: Route) => JSON.stringify(a) === JSON.stringify(b)

export function push(h: History, route: Route): History {
  if (same(h.entries[h.index], route)) return h
  return { entries: [...h.entries.slice(0, h.index + 1), route], index: h.index + 1 }
}

export function replace(h: History, route: Route): History {
  return { entries: h.entries.map((r, i) => (i === h.index ? route : r)), index: h.index }
}

export function back(h: History): History {
  return h.index > 0 ? { ...h, index: h.index - 1 } : h
}

export function forward(h: History): History {
  return h.index < h.entries.length - 1 ? { ...h, index: h.index + 1 } : h
}

const TABS: readonly string[] = ['playlists', 'albums', 'artists', 'songs']
const isString = (value: unknown) => typeof value === 'string'

function isRoute(value: unknown): value is Route {
  const r = value as Record<string, unknown> | null
  if (typeof r !== 'object' || r === null) return false
  switch (r.name) {
    case 'home':
      return true
    case 'search':
      return isString(r.query) && (r.params === undefined || isString(r.params))
    case 'album':
    case 'playlist':
    case 'artist':
      return isString(r.browseId)
    case 'library':
      return TABS.includes(r.tab as string)
    default:
      return false
  }
}

/**
 * The history rides in the page URL's `history` query item, so a reload after the web content process dies (which
 * keeps the URL) comes back on the same screen. Anything malformed reads as null.
 */
export function toSearch(h: History): string {
  return `?${new URLSearchParams({ history: JSON.stringify(h) })}`
}

export function fromSearch(search: string): History | null {
  try {
    const h = JSON.parse(new URLSearchParams(search).get('history') ?? '') as History
    const valid = Array.isArray(h.entries) && h.entries.length > 0 && h.entries.every(isRoute)
    return valid && Number.isInteger(h.index) && h.index >= 0 && h.index < h.entries.length ? h : null
  } catch {
    return null
  }
}

const inPage = typeof location !== 'undefined'
const history = createStore<History>((inPage && fromSearch(location.search)) || { entries: [{ name: 'home' }], index: 0 })
if (inPage) history.subscribe(() => window.history.replaceState(null, '', toSearch(history.get()) + location.hash))

export const navigate = (route: Route) => history.set(push(history.get(), route))
export const replaceRoute = (route: Route) => history.set(replace(history.get(), route))
export const goBack = () => history.set(back(history.get()))
export const goForward = () => history.set(forward(history.get()))
export const useHistory = () => useStore(history)
export function currentRoute(): Route {
  const h = history.get()
  return h.entries[h.index]
}
