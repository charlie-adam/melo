import { describe, expect, it } from 'vitest'
import { fixture } from '../fixture'
import { checkStatus, parseAddedSetVideoId, parseContainingPlaylists, parseCreatedPlaylistId } from './mutation'

describe('mutation responses', () => {
  it('accepts a missing or succeeded status and rejects any other', () => {
    expect(() => checkStatus({})).not.toThrow()
    expect(() => checkStatus({ status: 'STATUS_SUCCEEDED' })).not.toThrow()
    expect(() => checkStatus({ status: 'STATUS_FAILED' })).toThrow()
  })

  it('reads the created playlist id from the top level or the toast', () => {
    expect(parseCreatedPlaylistId({ playlistId: 'PLnew', status: 'STATUS_SUCCEEDED' })).toBe('PLnew')
    const nested = {
      actions: [{ addToToastAction: { item: { notificationTextRenderer: { navigationEndpoint: { browseEndpoint: { playlistId: 'PLnested' } } } } } }],
    }
    expect(parseCreatedPlaylistId(nested)).toBe('PLnested')
    expect(parseCreatedPlaylistId({})).toBeUndefined()
  })

  it('reads the added row setVideoId', () => {
    const raw = { status: 'STATUS_SUCCEEDED', playlistEditResults: [{ playlistEditVideoAddedResultData: { videoId: 'v1', setVideoId: 's1' } }] }
    expect(parseAddedSetVideoId(raw)).toBe('s1')
    expect(parseAddedSetVideoId({ status: 'STATUS_SUCCEEDED' })).toBeUndefined()
    expect(() => parseAddedSetVideoId({ status: 'STATUS_FAILED' })).toThrow()
  })

  it('reads which playlists already hold the song from the add-to-playlist menu', () => {
    expect([...parseContainingPlaylists(fixture('synthetic-add-to-playlist'))]).toEqual(['PLsyntheticplaylist0001'])
    expect(parseContainingPlaylists({}).size).toBe(0)
  })
})
