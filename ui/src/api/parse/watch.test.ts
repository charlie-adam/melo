import { describe, expect, it } from 'vitest'
import { fixture } from '../fixture'
import { parseLyrics, parseRelated, parseWatchNext, parseWatchNextContinuation } from './watch'

describe('parseWatchNext', () => {
  it('without a playlist: the current song, the radio id from automix, and the tab browse ids', () => {
    const next = parseWatchNext(fixture('next'))
    expect(next.items).toHaveLength(1)
    expect(next.items[0]).toMatchObject({
      videoId: '_1KDA806Klg',
      title: 'Kinetic',
      artists: [{ name: 'Radiohead', browseId: 'UCr_iyUANcn9OX_yy9piYoLw' }],
      album: { name: 'Pyramid Song', browseId: 'MPREb_fJhu6dGJXTo' },
      durationSec: 247,
      isVideo: false,
    })
    expect(next.playlistId).toBe('RDAMVM_1KDA806Klg')
    expect(next.lyricsBrowseId).toBe('MPLYt_fJhu6dGJXTo-5')
    expect(next.relatedBrowseId).toBe('MPTRt_fJhu6dGJXTo-5')
    expect(next.likeStatus).toBe('INDIFFERENT')
    expect(next.continuation).toBeUndefined()
  })

  it("reads the like status from the action bar, where YouTube Music now puts it", () => {
    // Synthetic: the shape of a signed-in response from November 2026, cut down to the like button.
    const likeButton = { likeButtonViewModel: { likeStatusEntity: { likeStatus: 'LIKE' } } }
    const raw = {
      playerOverlays: {
        playerOverlayRenderer: {
          videoActionBar: { videoActionBarViewModel: { buttons: [{ buttonViewModel: { segmentedLikeDislikeButtonViewModel: { likeButtonViewModel: likeButton } } }] } },
        },
      },
    }
    expect(parseWatchNext(raw).likeStatus).toBe('LIKE')
  })

  it('with a radio playlist: 50 items and a radio continuation', () => {
    const radio = parseWatchNext(fixture('next-radio'))
    expect(radio.items).toHaveLength(50)
    expect(radio.playlistId).toBe('RDAMVM_1KDA806Klg')
    expect(radio.continuation).toBeTruthy()
    expect(radio.items[1]).toMatchObject({ title: 'Fog', album: { name: 'Knives Out' } })
  })

  it('unwraps playlistPanelVideoWrapperRenderer', () => {
    const raw = {
      contents: {
        singleColumnMusicWatchNextResultsRenderer: {
          tabbedRenderer: {
            watchNextTabbedResultsRenderer: {
              tabs: [
                {
                  tabRenderer: {
                    content: {
                      musicQueueRenderer: {
                        content: {
                          playlistPanelRenderer: {
                            contents: [
                              { playlistPanelVideoWrapperRenderer: { primaryRenderer: { playlistPanelVideoRenderer: { videoId: 'v1', title: { runs: [{ text: 'One' }] } } } } },
                            ],
                          },
                        },
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    }
    expect(parseWatchNext(raw).items).toMatchObject([{ videoId: 'v1', title: 'One' }])
  })
})

describe('parseWatchNextContinuation', () => {
  it('reads the next radio page and its token', () => {
    const page = parseWatchNextContinuation(fixture('next-radio-continuation'))
    expect(page.items).toHaveLength(49)
    expect(page.continuation).toBeTruthy()
  })
})

describe('parseLyrics', () => {
  it('reads plain lyrics and their source', () => {
    // The committed fixture has its lyric lines replaced with placeholders.
    const lyrics = parseLyrics(fixture('lyrics'))
    expect(lyrics?.source).toBe('Source: LyricFind')
    expect(lyrics?.text.split('\n')[0]).toBe('Placeholder line 1')
    expect(lyrics?.text).not.toContain('\r')
  })

  it('returns undefined when the song has no lyrics', () => {
    expect(parseLyrics({ contents: { messageRenderer: { text: { runs: [{ text: 'Lyrics not available' }] } } } })).toBeUndefined()
  })
})

describe('parseRelated', () => {
  it('reads the related carousels and drops empty sections', () => {
    const carousel = (title: string, contents: unknown[]) => ({
      musicCarouselShelfRenderer: { header: { musicCarouselShelfBasicHeaderRenderer: { title: { runs: [{ text: title }] } } }, contents },
    })
    const song = {
      musicResponsiveListItemRenderer: {
        flexColumns: [{ musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Song', navigationEndpoint: { watchEndpoint: { videoId: 'v1' } } }] } } }],
      },
    }
    const raw = { contents: { sectionListRenderer: { contents: [carousel('You might also like', [song]), carousel('Empty', []), { musicDescriptionShelfRenderer: {} }] } } }
    expect(parseRelated(raw)).toMatchObject([{ title: 'You might also like', items: [{ kind: 'song', videoId: 'v1' }] }])
  })
})
