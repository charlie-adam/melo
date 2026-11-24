import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addToPlaylist, createPlaylist, removeFromPlaylist, setLiked, setSaved, setSubscribed } from './actions'
import { ApiCallError, call } from './api/call'
import type { Album, ArtistPage, Playlist, Song } from './api/models'
import type { ApiRequest } from './api/requests'
import { recall, reconcile, resetLibraryState } from './library'
import { toast } from './toasts'

vi.mock('./api/call', async (original) => ({ ...(await original<typeof import('./api/call')>()), call: vi.fn() }))
vi.mock('./toasts', () => ({ toast: vi.fn() }))
// The real bridge client needs a browser window. call is mocked, so only library.broadcast reaches it.
vi.mock('./bridge/client', () => ({ request: vi.fn(() => Promise.resolve(null)), on: vi.fn() }))

const callMock = vi.mocked(call)
const toastMock = vi.mocked(toast)

const song: Song = { kind: 'song', videoId: 'v1', title: 'Paper Lanterns', artists: [], thumbnails: [], explicit: false, isVideo: false, playable: true, likeStatus: 'INDIFFERENT', setVideoId: 's1' }
const album: Album = { kind: 'album', browseId: 'MPREb_a', playlistId: 'OLAK5uy_a', title: 'Isobars', artists: [], thumbnails: [], explicit: false, subtitle: '' }
const playlist: Playlist = { kind: 'playlist', browseId: 'VLPLa', playlistId: 'PLa', title: 'Late trains', thumbnails: [], subtitle: '' }

/** Library list responses in the shape parseLibrary and parsePlaylistPage read. */
function libraryResponse(items: unknown[]) {
  return { contents: { singleColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [{ gridRenderer: { items } }] } } } }] } } }
}
const albumTile = (browseId: string) => ({
  musicTwoRowItemRenderer: {
    title: { runs: [{ text: 'Isobars' }] },
    navigationEndpoint: { browseEndpoint: { browseId, browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: 'MUSIC_PAGE_TYPE_ALBUM' } } } },
  },
})

const requested = () => callMock.mock.calls.map(([req]) => req as ApiRequest)
const browses = () => requested().filter((r) => r.endpoint === 'browse')

beforeEach(() => {
  vi.useFakeTimers()
  resetLibraryState()
  callMock.mockReset()
  toastMock.mockReset()
})
afterEach(() => vi.useRealTimers())

describe('likes', () => {
  it('sends like/like and shows the like before the call returns', async () => {
    let resolve!: (v: unknown) => void
    callMock.mockReturnValueOnce(new Promise((r) => (resolve = r)))
    const done = setLiked(song, true)
    expect(recall('song:v1')).toBe('LIKE')
    expect(reconcile<Song>('songs', []).map((s) => s.videoId)).toEqual(['v1'])
    expect(requested()[0]).toEqual({ endpoint: 'like/like', body: { target: { videoId: 'v1' } } })
    resolve({})
    await done
    expect(toastMock).not.toHaveBeenCalled()
  })

  it('sends like/removelike to unlike', async () => {
    callMock.mockResolvedValue({})
    await setLiked({ ...song, likeStatus: 'LIKE' }, false)
    expect(requested()[0]).toEqual({ endpoint: 'like/removelike', body: { target: { videoId: 'v1' } } })
    expect(recall('song:v1')).toBe('INDIFFERENT')
  })

  it('rolls back and says why when the call fails', async () => {
    callMock.mockRejectedValueOnce(new ApiCallError({ kind: 'network' }))
    await setLiked(song, true)
    expect(recall('song:v1')).toBe('INDIFFERENT')
    expect(reconcile<Song>('songs', [])).toEqual([])
    expect(toastMock).toHaveBeenCalledWith("Couldn't like the song. Check your connection.")
  })

  it('keeps a newer change when an older call fails', async () => {
    let reject!: (e: unknown) => void
    callMock.mockReturnValueOnce(new Promise((_, r) => (reject = r))).mockResolvedValue({})
    const first = setLiked(song, true)
    await setLiked(song, false)
    reject(new ApiCallError({ kind: 'http', status: 500 }))
    await first
    expect(recall('song:v1')).toBe('INDIFFERENT')
    expect(toastMock).toHaveBeenCalledWith("Couldn't like the song. Try again.")
  })
})

describe('reconciliation', () => {
  it('re-fetches 500 ms after the call and keeps the optimistic item until the server agrees', async () => {
    callMock.mockResolvedValueOnce({}) // like/like on the album's OLAK id
    await setSaved(album, true, false)
    expect(requested()[0]).toEqual({ endpoint: 'like/like', body: { target: { playlistId: 'OLAK5uy_a' } } })

    callMock.mockResolvedValueOnce(libraryResponse([])) // first check: not there yet
    await vi.advanceTimersByTimeAsync(499)
    expect(browses()).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(browses()).toEqual([{ endpoint: 'browse', body: { browseId: 'FEmusic_liked_albums' } }])
    expect(reconcile<Album>('albums', []).map((a) => a.browseId)).toEqual(['MPREb_a'])

    callMock.mockResolvedValueOnce(libraryResponse([albumTile('MPREb_a')])) // second check, 1 s later: agrees
    await vi.advanceTimersByTimeAsync(999)
    expect(browses()).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(browses()).toHaveLength(2)

    // Settled: no more checks, and a list fetched before the save still shows the album.
    await vi.advanceTimersByTimeAsync(10_000)
    expect(browses()).toHaveLength(2)
    expect(reconcile<Album>('albums', []).map((a) => a.browseId)).toEqual(['MPREb_a'])
  })

  it('lets the server list stand after three checks disagree', async () => {
    callMock.mockResolvedValueOnce({})
    await setSaved(album, true, false)
    callMock.mockResolvedValue(libraryResponse([]))
    await vi.advanceTimersByTimeAsync(500 + 1000 + 2000)
    expect(browses()).toHaveLength(3)
    expect(reconcile<Album>('albums', [])).toEqual([])
    await vi.advanceTimersByTimeAsync(10_000)
    expect(browses()).toHaveLength(3)
  })

  it('hides a removed playlist and offers Undo', async () => {
    callMock.mockResolvedValue({})
    await setSaved(playlist, false, true)
    expect(requested()[0]).toEqual({ endpoint: 'like/removelike', body: { target: { playlistId: 'PLa' } } })
    expect(reconcile('playlists', [playlist])).toEqual([])
    expect(toastMock).toHaveBeenCalledWith('Removed from library', expect.objectContaining({ label: 'Undo' }))

    toastMock.mock.calls[0][1]!.run()
    expect(recall('list:PLa')).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(requested()[1]).toEqual({ endpoint: 'like/like', body: { target: { playlistId: 'PLa' } } })
  })

  it('does not check a list before the mutation has succeeded', async () => {
    let resolve!: (v: unknown) => void
    callMock.mockReturnValueOnce(new Promise((r) => (resolve = r)))
    const done = setLiked(song, true)
    await vi.advanceTimersByTimeAsync(5000)
    expect(browses()).toEqual([])
    resolve({})
    await done
    callMock.mockResolvedValue({})
    await vi.advanceTimersByTimeAsync(500)
    expect(browses()).toEqual([{ endpoint: 'browse', body: { browseId: 'VLLM' } }])
  })
})

describe('playlists', () => {
  it('adds a song, and Undo removes the new row by its setVideoId', async () => {
    callMock.mockResolvedValueOnce({ status: 'STATUS_SUCCEEDED', playlistEditResults: [{ playlistEditVideoAddedResultData: { videoId: 'v1', setVideoId: 'new1' } }] })
    expect(await addToPlaylist(song, playlist)).toBe(true)
    expect(requested()[0]).toEqual({ endpoint: 'browse/edit_playlist', body: { playlistId: 'PLa', actions: [{ action: 'ACTION_ADD_VIDEO', addedVideoId: 'v1' }] } })
    expect(toastMock).toHaveBeenCalledWith('Added to Late trains', expect.objectContaining({ label: 'Undo' }))

    callMock.mockResolvedValueOnce({ status: 'STATUS_SUCCEEDED' })
    toastMock.mock.calls[0][1]!.run()
    await vi.advanceTimersByTimeAsync(0)
    expect(requested()[1]).toEqual({
      endpoint: 'browse/edit_playlist',
      body: { playlistId: 'PLa', actions: [{ action: 'ACTION_REMOVE_VIDEO', removedVideoId: 'v1', setVideoId: 'new1' }] },
    })
  })

  it('reports a failed add in plain words', async () => {
    callMock.mockResolvedValueOnce({ status: 'STATUS_FAILED' })
    expect(await addToPlaylist(song, playlist)).toBe(false)
    expect(toastMock).toHaveBeenCalledWith("Couldn't add to Late trains. Try again.")
  })

  it('hides a removed row at once and restores it when the call fails', async () => {
    let reject!: (e: unknown) => void
    callMock.mockReturnValueOnce(new Promise((_, r) => (reject = r)))
    const done = removeFromPlaylist(song, playlist)
    expect(recall('row:PLa:s1')).toBe(true)
    reject(new ApiCallError({ kind: 'network' }))
    await done
    expect(recall('row:PLa:s1')).toBe(false)
    expect(toastMock).toHaveBeenCalledWith("Couldn't remove from Late trains. Check your connection.")
  })

  it('creates a playlist with its first song and shows it in the rail before the server lists it', async () => {
    callMock.mockResolvedValueOnce({ playlistId: 'PLnew', status: 'STATUS_SUCCEEDED' })
    await createPlaylist('Gym 2026', 'UNLISTED', song)
    expect(requested()[0]).toEqual({ endpoint: 'playlist/create', body: { title: 'Gym 2026', privacyStatus: 'UNLISTED', videoIds: ['v1'] } })
    expect(reconcile('playlists', [playlist]).map((p) => p.playlistId)).toEqual(['PLnew', 'PLa'])
    const liked = { ...playlist, playlistId: 'LM', browseId: 'VLLM' }
    expect(reconcile('playlists', [liked, playlist]).map((p) => p.playlistId)).toEqual(['LM', 'PLnew', 'PLa'])
    expect(toastMock).toHaveBeenCalledWith('Added to Gym 2026')
    callMock.mockResolvedValue(libraryResponse([]))
    await vi.advanceTimersByTimeAsync(500)
    expect(browses()).toEqual([{ endpoint: 'browse', body: { browseId: 'FEmusic_liked_playlists' } }])
  })

  it('throws when create fails so the dialog can stay open', async () => {
    callMock.mockRejectedValueOnce(new ApiCallError({ kind: 'network' }))
    await expect(createPlaylist('Gym 2026', 'PRIVATE')).rejects.toThrow()
    expect(reconcile('playlists', [])).toEqual([])
  })
})

describe('subscriptions', () => {
  const page: ArtistPage = {
    artist: { kind: 'artist', browseId: 'UCbrowse', name: 'Isobars', thumbnails: [], subtitle: '' },
    channelId: 'UCchannel',
    subscribed: false,
    shelves: [],
  }

  it('subscribes with the subscribe-button channel id, not the browse id', async () => {
    callMock.mockResolvedValue({})
    await setSubscribed(page, true)
    expect(requested()[0]).toEqual({ endpoint: 'subscription/subscribe', body: { channelIds: ['UCchannel'] } })
    expect(recall('artist:UCchannel')).toBe(true)
  })

  it('rolls back a failed unsubscribe', async () => {
    callMock.mockRejectedValueOnce(new ApiCallError({ kind: 'auth' }))
    await setSubscribed({ ...page, subscribed: true }, false)
    expect(requested()[0]).toEqual({ endpoint: 'subscription/unsubscribe', body: { channelIds: ['UCchannel'] } })
    expect(recall('artist:UCchannel')).toBe(true)
    expect(toastMock).toHaveBeenCalledWith("Couldn't unsubscribe. Sign in again and retry.")
  })
})
