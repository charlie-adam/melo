import { describe, expect, it } from 'vitest'
import { back, forward, fromSearch, push, replace, toSearch, type History } from './history'

const start: History = { entries: [{ name: 'home' }], index: 0 }
const album = { name: 'album', browseId: 'MPREb_1' } as const
const artist = { name: 'artist', browseId: 'UC1' } as const

describe('history', () => {
  it('pushes, goes back and forward', () => {
    const h = push(push(start, album), artist)
    expect(h.index).toBe(2)
    expect(back(h).entries[back(h).index]).toEqual(album)
    expect(forward(back(h))).toEqual(h)
  })

  it('drops forward entries when pushing after going back', () => {
    const h = push(back(push(push(start, album), artist)), { name: 'library', tab: 'albums' })
    expect(h.entries).toEqual([{ name: 'home' }, album, { name: 'library', tab: 'albums' }])
    expect(forward(h)).toBe(h)
  })

  it('ignores a push of the current route', () => {
    const h = push(start, album)
    expect(push(h, { name: 'album', browseId: 'MPREb_1' })).toBe(h)
  })

  it('stops at either end', () => {
    expect(back(start)).toBe(start)
    expect(forward(start)).toBe(start)
  })

  it('replaces only the current entry', () => {
    const h = replace(push(start, { name: 'library', tab: 'playlists' }), { name: 'library', tab: 'songs' })
    expect(h.entries).toEqual([{ name: 'home' }, { name: 'library', tab: 'songs' }])
    expect(h.index).toBe(1)
  })

  it('round-trips through the page URL', () => {
    const h = push(push(start, album), { name: 'search', query: 'a&b=c', params: 'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D' })
    expect(fromSearch(toSearch(h))).toEqual(h)
    expect(fromSearch(toSearch(back(h)))).toEqual(back(h))
  })

  it('reads anything malformed as no history', () => {
    const search = (value: unknown) => `?${new URLSearchParams({ history: JSON.stringify(value) })}`
    expect(fromSearch('')).toBeNull()
    expect(fromSearch('?history=%7Bnot%20json')).toBeNull()
    expect(fromSearch(search({ entries: [], index: 0 }))).toBeNull()
    expect(fromSearch(search({ entries: [{ name: 'home' }], index: 1 }))).toBeNull()
    expect(fromSearch(search({ entries: [{ name: 'album' }], index: 0 }))).toBeNull()
    expect(fromSearch(search({ entries: [{ name: 'library', tab: 'nope' }], index: 0 }))).toBeNull()
    expect(fromSearch(search({ entries: [{ name: 'settings' }], index: 0 }))).toBeNull()
  })
})
