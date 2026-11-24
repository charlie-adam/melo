// Library mutations the screens call. Each one updates the shared state in ./library first, so
// every view of the same song, album or artist changes at once, then rolls back and says so if the call fails.
import { ApiCallError, call } from './api/call'
import type { Album, ArtistPage, LikeStatus, Playlist, Song } from './api/models'
import { checkStatus, parseAddedSetVideoId, parseCreatedPlaylistId } from './api/parse/mutation'
import { parseWatchNext } from './api/parse/watch'
import * as requests from './api/requests'
import type { ApiRequest, Privacy } from './api/requests'
import { confirmExpectation, expectInList, forgetExpectation, recall, remember, useKnown, useKnownMap, type Known, type ListName } from './library'
import { createStore, useStore } from './store'
import { toast } from './toasts'
import { useApi } from './useApi'

/** A playlist the user can add to or remove from. */
export type PlaylistTarget = Pick<Playlist, 'playlistId' | 'title'>

/** Plain words for a failed call: "Couldn't save. Check your connection." */
export function failureText(what: string, error: unknown): string {
  const kind = error instanceof ApiCallError ? error.error.kind : undefined
  if (kind === 'network') return `Couldn't ${what}. Check your connection.`
  if (kind === 'auth') return `Couldn't ${what}. Sign in again and retry.`
  return `Couldn't ${what}. Try again.`
}

// Bumped on every change to a key, so a failed call only rolls back if nothing newer has happened since.
const versions = new Map<string, number>()

interface Change {
  key: string
  value: Known
  /** What the screen showed before, from the response it holds. */
  before: Known | undefined
  list?: { name: ListName; id: string; present: boolean; item?: Album | Playlist | Song }
  request: ApiRequest
  /** Ends "Couldn't ..." in the error toast. */
  what: string
}

/** Applies `change` optimistically and sends it. Resolves with the response, or undefined after rolling back. */
async function mutate(change: Change): Promise<unknown> {
  const { key, list } = change
  const previous = recall(key) ?? change.before
  const version = (versions.get(key) ?? 0) + 1
  versions.set(key, version)
  remember(key, change.value)
  if (list) expectInList(list.name, list.id, list.present, list.item)
  try {
    const raw = await call(change.request)
    checkStatus(raw)
    if (list) confirmExpectation(list.name, list.id)
    return raw
  } catch (error) {
    if (versions.get(key) === version) {
      remember(key, previous)
      if (list) forgetExpectation(list.name, list.id)
    }
    toast(failureText(change.what, error))
    return undefined
  }
}

// Songs

const songKey = (videoId: string) => `song:${videoId}`

export function useLikeStatus(song: Song | undefined): LikeStatus {
  return useKnown(song && songKey(song.videoId), song?.likeStatus ?? 'INDIFFERENT')
}

/** Whether `song` is in Liked songs, as every view should show it. The player bar uses this too. */
export const useLiked = (song: Song | undefined) => useLikeStatus(song) === 'LIKE'

/**
 * `useLiked` for the playing song. Songs in the queue may carry no like status (a restored queue, radio), so this
 * reads it from `next`, as music.youtube.com does.
 */
export function useLikedNow(song: Song | undefined): boolean {
  const watch = useApi(song ? requests.next(song.videoId) : null, parseWatchNext).data
  return useLiked(song && { ...song, likeStatus: watch?.likeStatus ?? song.likeStatus })
}

/** Likes, dislikes or clears a song's rating. */
export async function rate(song: Song, status: LikeStatus): Promise<void> {
  // A row's setVideoId belongs to the playlist it came from, not to Liked songs.
  const item: Song = { ...song, likeStatus: status, setVideoId: undefined }
  await mutate({
    key: songKey(song.videoId),
    value: status,
    before: song.likeStatus ?? 'INDIFFERENT',
    list: { name: 'songs', id: song.videoId, present: status === 'LIKE', item },
    request: requests.rateSong(song.videoId, status),
    what: status === 'LIKE' ? 'like the song' : 'update Liked songs',
  })
}

export const setLiked = (song: Song, liked: boolean) => rate(song, liked ? 'LIKE' : 'INDIFFERENT')

// Albums and playlists

/** The id the library calls take: an album's `OLAK5uy_` id, or a playlist's id without `VL`. */
const libraryId = (item: Album | Playlist) => item.playlistId

export function useSaved(item: Album | Playlist, fromServer: boolean): boolean {
  const id = libraryId(item)
  return useKnown(id && `list:${id}`, fromServer)
}

/** Saves an album or playlist to the library, or removes it, with Undo in the toast. */
export async function setSaved(item: Album | Playlist, saved: boolean, fromServer: boolean): Promise<void> {
  const id = libraryId(item)
  if (!id) return toast("This album can't be saved.")
  const raw = await mutate({
    key: `list:${id}`,
    value: saved,
    before: fromServer,
    list: { name: item.kind === 'album' ? 'albums' : 'playlists', id: item.kind === 'album' ? item.browseId : id, present: saved, item },
    request: requests.savePlaylist(id, saved),
    what: saved ? 'save to your library' : 'remove from your library',
  })
  if (raw === undefined) return
  toast(saved ? 'Saved to library' : 'Removed from library', { label: 'Undo', run: () => void setSaved(item, !saved, fromServer) })
}

// Playlist rows

const rowKey = (playlistId: string, setVideoId: string) => `row:${playlistId}:${setVideoId}`

/** `tracks` without the rows removed from `playlistId` in this session. */
export function useWithoutRemoved(playlistId: string | undefined, tracks: Song[]): Song[] {
  const map = useKnownMap()
  if (!playlistId) return tracks
  return tracks.filter((t) => !t.setVideoId || map.get(rowKey(playlistId, t.setVideoId)) !== true)
}

/** Resolves false when the call failed, after saying so. */
export async function addToPlaylist(song: Song, playlist: PlaylistTarget): Promise<boolean> {
  try {
    const setVideoId = parseAddedSetVideoId(await call(requests.addPlaylistItem(playlist.playlistId, song.videoId)))
    // Undo needs the new row's setVideoId; without one the toast has no Undo.
    toast(`Added to ${playlist.title}`, setVideoId ? { label: 'Undo', run: () => void removeFromPlaylist({ ...song, setVideoId }, playlist) } : undefined)
    return true
  } catch (error) {
    toast(failureText(`add to ${playlist.title}`, error))
    return false
  }
}

/** Removes one row from a playlist the user owns. The row needs its `setVideoId`. */
export async function removeFromPlaylist(song: Song, playlist: PlaylistTarget): Promise<void> {
  if (!song.setVideoId) return
  const raw = await mutate({
    key: rowKey(playlist.playlistId, song.setVideoId),
    value: true,
    before: false,
    request: requests.removePlaylistItem(playlist.playlistId, song.videoId, song.setVideoId),
    what: `remove from ${playlist.title}`,
  })
  if (raw === undefined) return
  const key = rowKey(playlist.playlistId, song.setVideoId)
  toast(`Removed from ${playlist.title}`, {
    label: 'Undo',
    // The song goes back at the end of the playlist; this view shows it where it was until the page reloads.
    run: () => void addToPlaylist(song, playlist).then((ok) => ok && remember(key, false)),
  })
}

// New playlists

const dialog = createStore<{ song?: Song } | undefined>(undefined)

export const useNewPlaylistDialog = () => useStore(dialog)
export const closeNewPlaylist = () => dialog.set(undefined)

/** Opens the new-playlist dialog, with `song` as the first track when given. */
export function newPlaylist(song?: Song) {
  dialog.set({ song })
}

/** Creates a playlist and shows it in the rail straight away. Throws on failure so the dialog can stay open. */
export async function createPlaylist(title: string, privacy: Privacy, song?: Song): Promise<void> {
  const id = parseCreatedPlaylistId(await call(requests.createPlaylist(title, privacy, song ? [song.videoId] : [])))
  if (!id) throw new Error('playlist/create returned no playlist id')
  const playlist: Playlist = { kind: 'playlist', browseId: `VL${id}`, playlistId: id, title, thumbnails: song?.thumbnails ?? [], subtitle: '' }
  expectInList('playlists', id, true, playlist)
  confirmExpectation('playlists', id)
  toast(song ? `Added to ${title}` : `Created ${title}`)
}

// Artists

const artistKey = (page: ArtistPage) => page.channelId && `artist:${page.channelId}`

export const useSubscribed = (page: ArtistPage) => useKnown(artistKey(page), page.subscribed)

export async function setSubscribed(page: ArtistPage, subscribed: boolean): Promise<void> {
  const key = artistKey(page)
  if (!key) return
  await mutate({
    key,
    value: subscribed,
    before: page.subscribed,
    request: requests.subscribe(page.channelId!, subscribed),
    what: subscribed ? 'subscribe' : 'unsubscribe',
  })
}
