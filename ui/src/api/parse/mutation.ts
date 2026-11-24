// Responses to library mutations. Shapes follow Kaset's PlaylistParser, and ytmusicapi's
// add_playlist_items for the added row's setVideoId.
import { findKey, type Raw } from './common'

/** Throws when the response reports a status other than success. Most mutations return no status at all. */
export function checkStatus(raw: Raw): void {
  const status = raw?.status
  if (typeof status === 'string' && !status.includes('SUCCEEDED')) throw new Error(`Mutation status ${status}`)
}

/** The new playlist's id: top-level `playlistId`, else the one in the toast's browse endpoint. */
export function parseCreatedPlaylistId(raw: Raw): string | undefined {
  checkStatus(raw)
  if (typeof raw?.playlistId === 'string' && raw.playlistId) return raw.playlistId
  const id = findKey(raw?.actions, 'browseEndpoint')?.playlistId
  return typeof id === 'string' && id ? id : undefined
}

/** The `setVideoId` YouTube Music gave the added row, which undoing the add needs. */
export function parseAddedSetVideoId(raw: Raw): string | undefined {
  checkStatus(raw)
  const results: Raw[] = raw?.playlistEditResults ?? []
  const id = results.find((r) => r.playlistEditVideoAddedResultData)?.playlistEditVideoAddedResultData.setVideoId
  return typeof id === 'string' ? id : undefined
}

/** Ids of the playlists in the add-to-playlist menu that already hold every requested song. */
export function parseContainingPlaylists(raw: Raw): Set<string> {
  const options: Raw[] = findKey(raw, 'addToPlaylistRenderer')?.playlists ?? []
  const ids = options
    .map((o) => o?.playlistAddToOptionRenderer)
    .filter((o) => o?.containsSelectedVideos === 'ALL' && typeof o.playlistId === 'string')
    .map((o) => o.playlistId as string)
  return new Set(ids)
}
