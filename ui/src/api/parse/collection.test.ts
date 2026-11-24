import { describe, expect, it } from 'vitest'
import { fixture } from '../fixture'
import { parseAlbumPage, parsePlaylistContinuation, parsePlaylistPage } from './collection'

describe('parseAlbumPage', () => {
  const page = parseAlbumPage(fixture('album'), 'MPREb_yXhSI4FCUo6')

  it('reads the responsive header', () => {
    expect(page.album).toMatchObject({
      kind: 'album',
      browseId: 'MPREb_yXhSI4FCUo6',
      title: 'OK Computer',
      albumType: 'Album',
      year: '1997',
      artists: [{ name: 'Radiohead', browseId: 'UCr_iyUANcn9OX_yy9piYoLw' }],
      explicit: false,
    })
    expect(page.album.thumbnails.length).toBeGreaterThan(0)
    expect(page.description).toBe('Placeholder description')
    expect(page.secondSubtitle).toMatch(/songs/)
  })

  it('reads the library toggle, off in an anonymous capture', () => {
    expect(page.saved).toBe(false)
  })

  it('finds the OLAK playlist id, which differs from the MPRE browse id', () => {
    expect(page.album.playlistId).toBe('OLAK5uy_nc6afxSnmK8OFML8dF9q_0D1MBMXsGnL4')
  })

  it('reads every track and fills in the artist, album and art the rows omit', () => {
    expect(page.tracks).toHaveLength(12)
    expect(page.tracks[0]).toMatchObject({
      videoId: 'jNY_wLukVW0',
      title: 'Airbag',
      durationSec: 288,
      artists: [{ name: 'Radiohead', browseId: 'UCr_iyUANcn9OX_yy9piYoLw' }],
      album: { name: 'OK Computer', browseId: 'MPREb_yXhSI4FCUo6' },
      plays: '20M plays',
      playable: true,
    })
    expect(page.tracks[0].thumbnails).toEqual(page.album.thumbnails)
  })

  it('keeps the other carousels as shelves', () => {
    expect(page.shelves.map((s) => s.title)).toEqual(['Other versions', 'Releases for you'])
    expect(page.shelves[0].items.every((i) => i.kind === 'album')).toBe(true)
  })
})

describe('parsePlaylistPage', () => {
  const page = parsePlaylistPage(fixture('playlist'), 'VLPLsQbRHUWk1i0K9pFuZn1LDXX04ILud6ue')

  it('reads the library toggle, and someone else\'s playlist is not editable', () => {
    expect(page.saved).toBe(false)
    expect(page.editable).toBeUndefined()
  })

  it('reads the header with the facepile author and track count', () => {
    expect(page.playlist).toMatchObject({
      browseId: 'VLPLsQbRHUWk1i0K9pFuZn1LDXX04ILud6ue',
      playlistId: 'PLsQbRHUWk1i0K9pFuZn1LDXX04ILud6ue',
      title: 'Radiohead Full Discography',
      trackCount: 168,
    })
    // Real author names and channel ids are scrubbed from committed fixtures.
    expect(page.playlist.author?.browseId).toMatch(/^UCREDACTED/)
  })

  it('reads the first 100 tracks with setVideoId and the shelf continuation', () => {
    expect(page.tracks).toHaveLength(100)
    expect(page.tracks[0]).toMatchObject({ videoId: 'E_Y3omYvPaE', title: 'Stupid Car', setVideoId: '289F4A46DF0A30D2', album: { name: 'Drill EP' } })
    expect(page.continuation).toMatch(/^4qmF/)
  })

  it('reads the explicit badge on playlist rows', () => {
    expect(page.tracks.find((t) => t.videoId === 'zFYEYRcjK2g')?.explicit).toBe(true)
    expect(page.tracks[0].explicit).toBe(false)
  })
})

describe('parsePlaylistContinuation', () => {
  it('reads the append-action page; the last page has no token', () => {
    const page = parsePlaylistContinuation(fixture('playlist-continuation'))
    expect(page.tracks).toHaveLength(68)
    expect(page.continuation).toBeUndefined()
  })

  it('adds up to the header track count across both pages', () => {
    const first = parsePlaylistPage(fixture('playlist'), 'VLPLsQbRHUWk1i0K9pFuZn1LDXX04ILud6ue')
    const rest = parsePlaylistContinuation(fixture('playlist-continuation'))
    expect(first.tracks.length + rest.tracks.length).toBe(first.playlist.trackCount)
  })

  it('reads the older musicPlaylistShelfContinuation format', () => {
    const page = parsePlaylistContinuation({
      continuationContents: {
        musicPlaylistShelfContinuation: { contents: [], continuations: [{ nextContinuationData: { continuation: 'older-token' } }] },
      },
    })
    expect(page).toEqual({ tracks: [], continuation: 'older-token' })
  })
})

describe('parsePlaylistPage, liked songs', () => {
  // Synthetic: hand-built from Kaset's paths, since VLLM needs a signed-in account.
  const page = parsePlaylistPage(fixture('synthetic-liked-songs'), 'VLLM')

  it('reads the header inside the editable header wrapper', () => {
    expect(page.playlist).toMatchObject({ browseId: 'VLLM', playlistId: 'LM', title: 'Liked music', trackCount: 2345 })
    expect(page.editable).toBe(true)
  })

  it('reads like status and takes setVideoId from the remove menu when playlistItemData lacks it', () => {
    expect(page.tracks[0]).toMatchObject({ likeStatus: 'LIKE', setVideoId: 'SYNTHSET0001', playable: true })
  })

  it('marks greyed-out rows unplayable', () => {
    expect(page.tracks[1]).toMatchObject({ videoId: 'synthVid0002', playable: false })
  })

  it('reads the continuation item token', () => {
    expect(page.continuation).toBe('synthetic-liked-token')
  })
})
