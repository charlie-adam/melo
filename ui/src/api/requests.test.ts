import { describe, expect, it } from 'vitest'
import * as r from './requests'

describe('requests', () => {
  it('builds library browse ids', () => {
    expect(r.home()).toEqual({ endpoint: 'browse', body: { browseId: 'FEmusic_home' } })
    expect(r.libraryPlaylists().body).toEqual({ browseId: 'FEmusic_liked_playlists' })
    expect(r.libraryAlbums().body).toEqual({ browseId: 'FEmusic_liked_albums' })
    expect(r.libraryArtists().body).toEqual({ browseId: 'FEmusic_library_corpus_artists', params: 'ggMCCAU=' })
    expect(r.likedSongs().body).toEqual({ browseId: 'VLLM' })
  })

  it('adds VL to bare playlist ids only', () => {
    expect(r.playlist('PLabc').body).toEqual({ browseId: 'VLPLabc' })
    expect(r.playlist('OLAK5uy_x').body).toEqual({ browseId: 'VLOLAK5uy_x' })
    expect(r.playlist('VLPLabc').body).toEqual({ browseId: 'VLPLabc' })
    expect(r.playlist('RDCLAK5uy_x').body).toEqual({ browseId: 'RDCLAK5uy_x' })
  })

  it('builds search, filtered search and suggestions', () => {
    expect(r.search('q')).toEqual({ endpoint: 'search', body: { query: 'q' } })
    expect(r.search('q', r.SEARCH_FILTERS.songs).body).toEqual({ query: 'q', params: 'EgWKAQIIAWoMEA4QChADEAQQCRAF' })
    expect(r.suggestions('rad')).toEqual({ endpoint: 'music/get_search_suggestions', body: { input: 'rad' } })
  })

  it('sends each continuation to the endpoint it came from', () => {
    expect(r.browseContinuation('t')).toEqual({ endpoint: 'browse', body: { continuation: 't' } })
    expect(r.searchContinuation('t')).toEqual({ endpoint: 'search', body: { continuation: 't' } })
    expect(r.nextContinuation('t')).toEqual({ endpoint: 'next', body: { continuation: 't', enablePersistentPlaylistPanel: true, isAudioOnly: true } })
  })

  it('builds next, radio and lyrics', () => {
    expect(r.next('v1')).toEqual({
      endpoint: 'next',
      body: { videoId: 'v1', enablePersistentPlaylistPanel: true, isAudioOnly: true, tunerSettingValue: 'AUTOMIX_SETTING_NORMAL' },
    })
    expect(r.radio('v1').body).toMatchObject({ videoId: 'v1', playlistId: 'RDAMVMv1' })
    expect(r.lyrics('MPLYt_x')).toEqual({ endpoint: 'browse', body: { browseId: 'MPLYt_x' } })
    expect(r.browse('UCx', 'p').body).toEqual({ browseId: 'UCx', params: 'p' })
  })

  it('builds the account menu and a playlist queue without a starting song', () => {
    expect(r.accountMenu()).toEqual({ endpoint: 'account/account_menu', body: {} })
    expect(r.watchPlaylist('RDEMx')).toEqual({ endpoint: 'next', body: { playlistId: 'RDEMx', enablePersistentPlaylistPanel: true, isAudioOnly: true } })
  })

  it('builds like, dislike and clear for a song', () => {
    expect(r.rateSong('v1', 'LIKE')).toEqual({ endpoint: 'like/like', body: { target: { videoId: 'v1' } } })
    expect(r.rateSong('v1', 'DISLIKE')).toEqual({ endpoint: 'like/dislike', body: { target: { videoId: 'v1' } } })
    expect(r.rateSong('v1', 'INDIFFERENT')).toEqual({ endpoint: 'like/removelike', body: { target: { videoId: 'v1' } } })
  })

  it('saves and removes playlists and albums by playlist id without VL', () => {
    expect(r.savePlaylist('VLPLabc', true)).toEqual({ endpoint: 'like/like', body: { target: { playlistId: 'PLabc' } } })
    expect(r.savePlaylist('OLAK5uy_x', false)).toEqual({ endpoint: 'like/removelike', body: { target: { playlistId: 'OLAK5uy_x' } } })
  })

  it('creates a playlist, with a first song only when given', () => {
    expect(r.createPlaylist('Late trains', 'PRIVATE')).toEqual({ endpoint: 'playlist/create', body: { title: 'Late trains', privacyStatus: 'PRIVATE' } })
    expect(r.createPlaylist('Late trains', 'UNLISTED', ['v1']).body).toEqual({ title: 'Late trains', privacyStatus: 'UNLISTED', videoIds: ['v1'] })
  })

  it('adds and removes playlist rows', () => {
    expect(r.addToPlaylistMenu('v1')).toEqual({ endpoint: 'playlist/get_add_to_playlist', body: { videoIds: ['v1'] } })
    expect(r.addPlaylistItem('VLPLabc', 'v1')).toEqual({
      endpoint: 'browse/edit_playlist',
      body: { playlistId: 'PLabc', actions: [{ action: 'ACTION_ADD_VIDEO', addedVideoId: 'v1' }] },
    })
    expect(r.removePlaylistItem('PLabc', 'v1', 's1')).toEqual({
      endpoint: 'browse/edit_playlist',
      body: { playlistId: 'PLabc', actions: [{ action: 'ACTION_REMOVE_VIDEO', removedVideoId: 'v1', setVideoId: 's1' }] },
    })
  })

  it('subscribes and unsubscribes by channel id', () => {
    expect(r.subscribe('UCx', true)).toEqual({ endpoint: 'subscription/subscribe', body: { channelIds: ['UCx'] } })
    expect(r.subscribe('UCx', false)).toEqual({ endpoint: 'subscription/unsubscribe', body: { channelIds: ['UCx'] } })
  })
})
