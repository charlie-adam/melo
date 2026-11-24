import { describe, expect, it } from 'vitest'
import { fixture } from '../fixture'
import { parseArtistPage } from './artist'

describe('parseArtistPage', () => {
  const page = parseArtistPage(fixture('artist'), 'UCr_iyUANcn9OX_yy9piYoLw')

  it('reads the immersive header', () => {
    expect(page.artist).toMatchObject({ kind: 'artist', browseId: 'UCr_iyUANcn9OX_yy9piYoLw', name: 'Radiohead', subtitle: '206M monthly audience' })
    expect(page.artist.thumbnails.length).toBeGreaterThan(0)
    expect(page.description).toBe('Placeholder description')
    expect(page.subscribed).toBe(false)
  })

  it('reads the subscribe channel id, which is not the browse id', () => {
    expect(page.channelId).toBe('UCq19-LqvG35A-30oyAiPiqA')
  })

  it('reads the mix and shuffle playlist ids', () => {
    expect(page.radioPlaylistId).toMatch(/^RDEM/)
    expect(page.shufflePlaylistId).toMatch(/^RDAO/)
  })

  it('reads every shelf with its More link', () => {
    expect(page.shelves.map((s) => s.title)).toEqual([
      'Top songs',
      'Albums',
      'Singles & EPs',
      'Videos',
      'Live performances',
      'Featured on',
      'Playlists by Radiohead',
      'Fans might also like',
    ])
    expect(page.shelves[0].more?.browseId).toMatch(/^VLOLAK/)
    expect(page.shelves[1].more).toMatchObject({ browseId: 'MPADUCr_iyUANcn9OX_yy9piYoLw' })
    expect(page.shelves.find((s) => s.title === 'Featured on')?.more).toBeUndefined()
  })

  it('reads top songs with album and explicit badge', () => {
    expect(page.shelves[0].items[0]).toMatchObject({ kind: 'song', title: 'Creep', explicit: true, album: { name: 'Pablo Honey' }, plays: '2.4B plays' })
  })

  it('gives albums the page artist their subtitle leaves out', () => {
    expect(page.shelves[1].items[0]).toMatchObject({
      kind: 'album',
      title: 'KID A MNESIA',
      year: '2021',
      playlistId: 'OLAK5uy_m8Yan_MSAia_ZYmZpl6xm1AINDg8LF1NI',
      artists: [{ name: 'Radiohead', browseId: 'UCr_iyUANcn9OX_yy9piYoLw' }],
    })
    expect(page.shelves[2].items[0]).toMatchObject({ albumType: 'Single' })
  })

  it('marks music videos and reads related artists', () => {
    expect(page.shelves[3].items[0]).toMatchObject({ kind: 'song', isVideo: true, title: 'Creep' })
    expect(page.shelves[7].items.every((i) => i.kind === 'artist')).toBe(true)
  })
})
