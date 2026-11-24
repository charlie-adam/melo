import { describe, expect, it } from 'vitest'
import { fixture } from '../fixture'
import { parseSearch, parseSearchContinuation, parseSuggestions } from './search'

describe('parseSearch, unfiltered', () => {
  const results = parseSearch(fixture('search-all'))

  it('reads the top result card and its songs, which inherit the card artist', () => {
    expect(results.topResult?.item).toMatchObject({ kind: 'artist', name: 'Radiohead', browseId: 'UCr_iyUANcn9OX_yy9piYoLw' })
    expect(results.topResult?.contents).toHaveLength(3)
    expect(results.topResult?.contents[0]).toMatchObject({
      kind: 'song',
      title: 'Kinetic',
      durationSec: 247,
      plays: '520K plays',
      artists: [{ name: 'Radiohead', browseId: 'UCr_iyUANcn9OX_yy9piYoLw' }],
    })
  })

  it('merges the one-item sections into one untitled section in server order', () => {
    expect(results.sections).toHaveLength(1)
    expect(results.sections[0].title).toBeUndefined()
    const kinds = results.sections[0].items.map((i) => i.kind)
    expect(kinds.slice(0, 3)).toEqual(['album', 'album', 'song'])
    expect(kinds).toContain('playlist')
    expect(kinds).toContain('artist')
    expect(kinds).toContain('profile')
  })

  it('drops podcast episodes and shows', () => {
    const titles = results.sections[0].items.map((i) => ('name' in i ? i.name : i.title))
    expect(titles).not.toContain('Grow Up Slowly Pod')
  })

  it('reads album results with the OLAK id from the play button', () => {
    expect(results.sections[0].items[0]).toMatchObject({
      kind: 'album',
      browseId: 'MPREb_yXhSI4FCUo6',
      playlistId: 'OLAK5uy_nc6afxSnmK8OFML8dF9q_0D1MBMXsGnL4',
      title: 'OK Computer',
      albumType: 'Album',
      year: '1997',
      artists: [{ name: 'Radiohead', browseId: 'UCr_iyUANcn9OX_yy9piYoLw' }],
    })
  })

  it('reads the filter chips, keeping their params as sent', () => {
    expect(results.filters.map((f) => f.label)).toContain('Songs')
    expect(results.filters.find((f) => f.label === 'Featured playlists')?.params).toMatch(/%3D$/)
  })

  it('has no continuation', () => {
    expect(results.continuation).toBeUndefined()
  })

  it('parses the search Keys captured', () => {
    expect(parseSearch(fixture('anon-search')).topResult).toBeDefined()
  })
})

describe('parseSearch, filtered', () => {
  it.each([
    ['songs', 'Songs', 'song'],
    ['videos', 'Videos', 'song'],
    ['albums', 'Albums', 'album'],
    ['artists', 'Artists', 'artist'],
    ['playlists', 'Community playlists', 'playlist'],
    ['featured-playlists', 'Featured playlists', 'playlist'],
    ['community-playlists', 'Community playlists', 'playlist'],
    ['profiles', 'Profiles', 'profile'],
  ])('%s: one titled shelf of %s', (name, title, kind) => {
    const results = parseSearch(fixture(`search-${name}`))
    expect(results.topResult).toBeUndefined()
    expect(results.sections).toHaveLength(1)
    expect(results.sections[0].title).toBe(title)
    expect(results.sections[0].items.length).toBeGreaterThan(0)
    expect(results.sections[0].items.every((i) => i.kind === kind)).toBe(true)
  })

  it('reads song rows with artist, album and duration', () => {
    const song = parseSearch(fixture('search-songs')).sections[0].items[0]
    expect(song).toMatchObject({
      kind: 'song',
      videoId: '_1KDA806Klg',
      title: 'Kinetic',
      artists: [{ name: 'Radiohead', browseId: 'UCr_iyUANcn9OX_yy9piYoLw' }],
      album: { name: 'Pyramid Song', browseId: 'MPREb_fJhu6dGJXTo' },
      durationSec: 247,
      isVideo: false,
      playable: true,
    })
  })

  it('reads the explicit badge', () => {
    const items = parseSearch(fixture('search-songs')).sections[0].items
    const creep = items.find((i) => i.kind === 'song' && i.videoId === '9RfVp-GhKfs')
    expect(creep).toMatchObject({ explicit: true })
    expect(items.filter((i) => i.kind === 'song' && i.explicit)).toHaveLength(1)
  })

  it('marks videos and keeps the uploader as an artist', () => {
    const video = parseSearch(fixture('search-videos')).sections[0].items[0]
    expect(video).toMatchObject({ kind: 'song', isVideo: true })
    if (video.kind !== 'song') throw new Error('expected a song')
    expect(video.artists).toHaveLength(1)
    expect(video.durationSec).toBeGreaterThan(0)
  })

  it('reads featured playlist author and track count', () => {
    expect(parseSearch(fixture('search-featured-playlists')).sections[0].items[0]).toMatchObject({
      kind: 'playlist',
      title: 'Presenting Radiohead',
      author: { name: 'YouTube Music' },
      trackCount: 31,
    })
  })

  it('returns the shelf continuation when there are more results', () => {
    expect(parseSearch(fixture('search-songs')).continuation).toBeTruthy()
    expect(parseSearch(fixture('search-artists')).continuation).toBeUndefined()
  })
})

describe('parseSearchContinuation', () => {
  it('reads musicShelfContinuation items and the next token', () => {
    const page = parseSearchContinuation(fixture('search-songs-continuation'))
    expect(page.items).toHaveLength(20)
    expect(page.items.every((i) => i.kind === 'song')).toBe(true)
    expect(page.continuation).toBeTruthy()
  })

  it('reads the append-action format', () => {
    const page = parseSearchContinuation({
      onResponseReceivedCommands: [{ appendContinuationItemsAction: { continuationItems: [] } }],
    })
    expect(page).toEqual({ items: [] })
  })
})

describe('parseSuggestions', () => {
  const suggestions = parseSuggestions(fixture('suggestions'))

  it('reads query completions', () => {
    expect(suggestions.queries[0]).toBe('radiohead')
    expect(suggestions.queries).toHaveLength(6)
  })

  it('reads suggested items', () => {
    expect(suggestions.items[0]).toMatchObject({ kind: 'artist', name: 'Radiohead' })
    expect(suggestions.items.some((i) => i.kind === 'song')).toBe(true)
  })

  it('reads history suggestions', () => {
    const raw = {
      contents: [
        {
          searchSuggestionsSectionRenderer: {
            contents: [{ historySuggestionRenderer: { suggestion: { runs: [{ text: 'old query' }] }, navigationEndpoint: { searchEndpoint: { query: 'old query' } } } }],
          },
        },
      ],
    }
    expect(parseSuggestions(raw)).toEqual({ queries: ['old query'], items: [] })
  })
})
