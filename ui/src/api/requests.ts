// Pure builders for the InnerTube calls the screens make. Each returns `{ endpoint, body }` for `api.call`; Swift adds
// the client context, auth and the API key. Ids and params follow what Kaset (MIT) sends.

export interface ApiRequest {
  endpoint: string
  body: Record<string, unknown>
}

/** Fallback filter params. Prefer the `params` on the response's own filter chips, which can vary by query. */
export const SEARCH_FILTERS = {
  songs: 'EgWKAQIIAWoMEA4QChADEAQQCRAF',
  videos: 'EgWKAQIQAWoMEA4QChADEAQQCRAF',
  albums: 'EgWKAQIYAWoMEA4QChADEAQQCRAF',
  artists: 'EgWKAQIgAWoMEA4QChADEAQQCRAF',
  playlists: 'EgWKAQIoAWoMEA4QChADEAQQCRAF',
  featuredPlaylists: 'EgeKAQQoADgBagwQDhAKEAMQBBAJEAU=',
  communityPlaylists: 'EgeKAQQoAEABagwQDhAKEAMQBBAJEAU=',
  profiles: 'EgWKAQJYAWoMEA4QChADEAQQCRAF',
} as const

const WATCH = { enablePersistentPlaylistPanel: true, isAudioOnly: true } as const

export function browse(browseId: string, params?: string): ApiRequest {
  return { endpoint: 'browse', body: params ? { browseId, params } : { browseId } }
}

/** Any browse continuation. The token goes in the body; there is no `ctoken` query. */
export function browseContinuation(continuation: string): ApiRequest {
  return { endpoint: 'browse', body: { continuation } }
}

export const home = (): ApiRequest => browse('FEmusic_home')
export const libraryPlaylists = (): ApiRequest => browse('FEmusic_liked_playlists')
/** Follow every continuation; stop if a token repeats. */
export const libraryAlbums = (): ApiRequest => browse('FEmusic_liked_albums')
export const libraryArtists = (): ApiRequest => browse('FEmusic_library_corpus_artists', 'ggMCCAU=')
/** Liked songs. `FEmusic_liked_videos` returns only about 13 songs and no continuation. */
export const likedSongs = (): ApiRequest => browse('VLLM')
export const album = (browseId: string): ApiRequest => browse(browseId)
export const artist = (browseId: string): ApiRequest => browse(browseId)
export const lyrics = (browseId: string): ApiRequest => browse(browseId)

/** Playlist page. Adds `VL` unless the id already carries a browse prefix; a bare `OLAK` id returns 400. */
export function playlist(id: string): ApiRequest {
  return browse(/^(VL|RD|MPRE|UC)/.test(id) ? id : `VL${id}`)
}

/** Unfiltered search when `params` is absent; otherwise a chip's `params` or a value from SEARCH_FILTERS. */
export function search(query: string, params?: string): ApiRequest {
  return { endpoint: 'search', body: params ? { query, params } : { query } }
}

/** Search continuations must go to `search`; sent to `browse` they return unrelated content. */
export function searchContinuation(continuation: string): ApiRequest {
  return { endpoint: 'search', body: { continuation } }
}

export function suggestions(input: string): ApiRequest {
  return { endpoint: 'music/get_search_suggestions', body: { input } }
}

/** Watch-next for a song: queue, lyrics and related tab ids. With `playlistId` it returns that queue or radio. */
export function next(videoId: string, playlistId?: string): ApiRequest {
  const body: Record<string, unknown> = { videoId, ...WATCH, tunerSettingValue: 'AUTOMIX_SETTING_NORMAL' }
  if (playlistId) body.playlistId = playlistId
  return { endpoint: 'next', body }
}

/** Song radio: `next` with `RDAMVM` + videoId. */
export function radio(videoId: string): ApiRequest {
  return next(videoId, `RDAMVM${videoId}`)
}

export function nextContinuation(continuation: string): ApiRequest {
  return { endpoint: 'next', body: { continuation, ...WATCH } }
}

/** The signed-in account's name and photo. */
export const accountMenu = (): ApiRequest => ({ endpoint: 'account/account_menu', body: {} })

/** Queue for a playlist without a starting song, such as an artist's shuffle (`watchPlaylistEndpoint`) or mix. */
export function watchPlaylist(playlistId: string): ApiRequest {
  return { endpoint: 'next', body: { playlistId, ...WATCH } }
}

// Mutations. Every one needs a signed-in account.

const withoutVL = (id: string) => (id.startsWith('VL') ? id.slice(2) : id)

const RATE_ENDPOINTS = { LIKE: 'like/like', DISLIKE: 'like/dislike', INDIFFERENT: 'like/removelike' } as const

/** Likes, dislikes or clears the rating of a song. */
export function rateSong(videoId: string, status: keyof typeof RATE_ENDPOINTS): ApiRequest {
  return { endpoint: RATE_ENDPOINTS[status], body: { target: { videoId } } }
}

/** Saves a playlist or album to the library, or removes it. Albums take their `OLAK5uy_` id, never `MPREb_`. */
export function savePlaylist(playlistId: string, saved: boolean): ApiRequest {
  return { endpoint: saved ? 'like/like' : 'like/removelike', body: { target: { playlistId: withoutVL(playlistId) } } }
}

export type Privacy = 'PRIVATE' | 'UNLISTED' | 'PUBLIC'

export function createPlaylist(title: string, privacyStatus: Privacy, videoIds: string[] = []): ApiRequest {
  const body: Record<string, unknown> = { title, privacyStatus }
  if (videoIds.length > 0) body.videoIds = videoIds
  return { endpoint: 'playlist/create', body }
}

/** The add-to-playlist menu, which marks the playlists that already hold the song. */
export const addToPlaylistMenu = (videoId: string): ApiRequest => ({ endpoint: 'playlist/get_add_to_playlist', body: { videoIds: [videoId] } })

export function addPlaylistItem(playlistId: string, videoId: string): ApiRequest {
  return { endpoint: 'browse/edit_playlist', body: { playlistId: withoutVL(playlistId), actions: [{ action: 'ACTION_ADD_VIDEO', addedVideoId: videoId }] } }
}

/** `setVideoId` picks the row, since a song can appear in a playlist more than once. */
export function removePlaylistItem(playlistId: string, videoId: string, setVideoId: string): ApiRequest {
  return {
    endpoint: 'browse/edit_playlist',
    body: { playlistId: withoutVL(playlistId), actions: [{ action: 'ACTION_REMOVE_VIDEO', removedVideoId: videoId, setVideoId }] },
  }
}

/** Takes the artist page's subscribe-button channel id, which can differ from its browse id. */
export function subscribe(channelId: string, subscribed: boolean): ApiRequest {
  return { endpoint: subscribed ? 'subscription/subscribe' : 'subscription/unsubscribe', body: { channelIds: [channelId] } }
}
