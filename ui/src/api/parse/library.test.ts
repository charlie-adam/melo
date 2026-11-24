// Every fixture here is synthetic: hand-built from Kaset's library parser paths, because
// library responses need a signed-in account.
import { describe, expect, it } from 'vitest'
import { fixture } from '../fixture'
import { parseLibrary, parseLibraryContinuation } from './library'

describe('parseLibrary', () => {
  it('reads saved playlists from a grid and skips the New playlist tile', () => {
    const page = parseLibrary(fixture('synthetic-library-playlists'))
    expect(page.items.map((i) => i.kind === 'playlist' && i.playlistId)).toEqual(['LM', 'PLsyntheticplaylist0001'])
    expect(page.items[1]).toMatchObject({ trackCount: 12 })
    expect(page.continuation).toBe('synthetic-playlists-token')
  })

  it('reads saved albums from a grid inside an itemSectionRenderer, with OLAK ids', () => {
    const page = parseLibrary(fixture('synthetic-library-albums'))
    expect(page.items).toHaveLength(2)
    expect(page.items[0]).toMatchObject({ kind: 'album', browseId: 'MPREb_synthetic0001', playlistId: 'OLAK5uy_synthetic0001', year: '1997' })
    expect(page.items[1]).toMatchObject({ albumType: 'Single' })
  })

  it('reads a token wrapped in commandExecutorCommand', () => {
    expect(parseLibrary(fixture('synthetic-library-albums')).continuation).toBe('synthetic-albums-token')
  })

  it('maps library artist ids from MPLAUC to UC', () => {
    const page = parseLibrary(fixture('synthetic-library-artists'))
    expect(page.items[0]).toMatchObject({ kind: 'artist', browseId: 'UCsyntheticartist0000001', name: 'Synthetic Artist', subtitle: '12 songs' })
    expect(page.continuation).toBeUndefined()
  })

  it('returns nothing for an empty library', () => {
    expect(parseLibrary({})).toEqual({ items: [] })
  })
})

describe('parseLibraryContinuation', () => {
  it('reads a grid continuation; the last page has no token', () => {
    const page = parseLibraryContinuation(fixture('synthetic-library-albums-continuation'))
    expect(page).toMatchObject({ items: [{ kind: 'album', albumType: 'EP' }] })
    expect(page.continuation).toBeUndefined()
  })
})
