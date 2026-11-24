import { describe, expect, it } from 'vitest'
import { fixture } from '../fixture'
import { parseHome, parseHomeChips, parseHomeContinuation } from './home'

describe('parseHome', () => {
  const home = parseHome(fixture('home'))

  it('reads carousel shelves with titles and straplines', () => {
    expect(home.shelves.map((s) => s.title)).toEqual(['Easy afternoon', 'Music for the season'])
    expect(home.shelves[1].strapline).toBeTruthy()
    expect(home.shelves[0].items).toHaveLength(8)
  })

  it('classifies two-row playlist cards and strips VL for the playlist id', () => {
    const first = home.shelves[0].items[0]
    expect(first).toMatchObject({ kind: 'playlist', title: 'Easy Rock' })
    if (first.kind !== 'playlist') throw new Error('expected a playlist')
    expect(first.browseId).toBe(`VL${first.playlistId}`)
    expect(first.thumbnails[0].url).toMatch(/^https:/)
  })

  it('drops the anonymous taste-builder section, which has no items', () => {
    expect(home.shelves.every((s) => s.items.length > 0)).toBe(true)
  })

  it('returns the feed continuation token', () => {
    expect(home.continuation).toMatch(/^4qmF/)
  })

  it('parses the keyless home that Keys captured', () => {
    expect(parseHome(fixture('anon-home')).shelves.length).toBeGreaterThan(0)
  })
})

describe('parseHomeContinuation', () => {
  it('returns no shelves and no token for the exhausted anonymous feed', () => {
    // Real capture: anonymous home continuations come back as an empty Home tab.
    expect(parseHomeContinuation(fixture('home-continuation'))).toEqual({ shelves: [] })
  })

  it('reads sectionListContinuation shelves and the next token', () => {
    const raw = {
      continuationContents: {
        sectionListContinuation: {
          contents: [
            {
              musicCarouselShelfRenderer: {
                header: { musicCarouselShelfBasicHeaderRenderer: { title: { runs: [{ text: 'Quick picks' }] } } },
                contents: [
                  {
                    musicResponsiveListItemRenderer: {
                      flexColumns: [
                        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Song', navigationEndpoint: { watchEndpoint: { videoId: 'v1' } } }] } } },
                      ],
                    },
                  },
                ],
              },
            },
          ],
          continuations: [{ nextContinuationData: { continuation: 'next-token' } }],
        },
      },
    }
    const page = parseHomeContinuation(raw)
    expect(page.continuation).toBe('next-token')
    expect(page.shelves[0]).toMatchObject({ title: 'Quick picks', items: [{ kind: 'song', videoId: 'v1', title: 'Song' }] })
  })
})

describe('parseHomeChips', () => {
  it('reads each mood chip with its browse params', () => {
    const chips = parseHomeChips(fixture('home'))
    expect(chips.length).toBeGreaterThan(3)
    expect(chips.map((c) => c.label)).toContain('Workout')
    expect(chips.every((c) => c.params.length > 0)).toBe(true)
  })
})
