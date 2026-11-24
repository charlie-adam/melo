import type { LikeStatus, Lyrics, QueuePage, Shelf, Song, WatchNext } from '../models'
import { album, artists, isExplicit, parseDuration, segments, shelves, text, thumbnails, type Raw } from './common'

/** Parses one queue entry, plain or wrapped. Returns undefined for anything else, such as the automix preview. */
function queueSong(wrapper: Raw): Song | undefined {
  const r = wrapper.playlistPanelVideoRenderer ?? wrapper.playlistPanelVideoWrapperRenderer?.primaryRenderer?.playlistPanelVideoRenderer
  if (!r?.videoId) return undefined
  const byline: Raw[] = r.longBylineText?.runs ?? []
  const videoType: string | undefined = r.navigationEndpoint?.watchEndpoint?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType
  const song: Song = {
    kind: 'song',
    videoId: r.videoId,
    title: text(r.title),
    // Artists are the first byline segment, before " • ".
    artists: artists(segments(byline)[0]),
    album: album(byline),
    durationSec: parseDuration(text(r.lengthText)),
    thumbnails: thumbnails(r.thumbnail),
    explicit: isExplicit(r),
    isVideo: videoType !== undefined && videoType !== 'MUSIC_VIDEO_TYPE_ATV',
    playable: true,
  }
  if (r.playlistSetVideoId) song.setVideoId = r.playlistSetVideoId
  return song
}

function queueSongs(wrappers: Raw[] = []): Song[] {
  return wrappers.map(queueSong).filter((s): s is Song => s !== undefined)
}

function radioContinuation(panel: Raw): string | undefined {
  return panel?.continuations?.[0]?.nextRadioContinuationData?.continuation
}

/**
 * Parses `next`: the queue, the radio continuation, and the browse ids of the Lyrics (`MPLYt`) and Related (`MPTRt`) tabs.
 * Without a `playlistId` in the request the queue holds only the current song, and the radio id comes from the automix preview.
 */
export function parseWatchNext(raw: Raw): WatchNext {
  const tabs: Raw[] = raw?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs ?? []
  const panel = tabs[0]?.tabRenderer?.content?.musicQueueRenderer?.content?.playlistPanelRenderer
  const contents: Raw[] = panel?.contents ?? []
  const result: WatchNext = { items: queueSongs(contents) }
  const automix = contents.find((c) => c.automixPreviewVideoRenderer)?.automixPreviewVideoRenderer
  const playlistId: string | undefined = panel?.playlistId ?? automix?.content?.automixPlaylistVideoRenderer?.navigationEndpoint?.watchPlaylistEndpoint?.playlistId
  if (playlistId) result.playlistId = playlistId
  const continuation = radioContinuation(panel)
  if (continuation) result.continuation = continuation
  for (const tab of tabs) {
    const id: string | undefined = tab.tabRenderer?.endpoint?.browseEndpoint?.browseId
    if (id?.startsWith('MPLYt')) result.lyricsBrowseId = id
    if (id?.startsWith('MPTRt')) result.relatedBrowseId = id
  }
  const like = overlayLikeStatus(raw?.playerOverlays?.playerOverlayRenderer)
  if (like) result.likeStatus = like
  return result
}

/**
 * The playing song's like status. YouTube Music moved it from `actions[].likeButtonRenderer` (still in older
 * responses) to the action bar's like and dislike view model.
 */
function overlayLikeStatus(overlay: Raw): LikeStatus | undefined {
  const buttons: Raw[] = overlay?.videoActionBar?.videoActionBarViewModel?.buttons ?? []
  const current: LikeStatus | undefined = buttons
    .map((b) => b.buttonViewModel?.segmentedLikeDislikeButtonViewModel?.likeButtonViewModel?.likeButtonViewModel?.likeStatusEntity?.likeStatus)
    .find(Boolean)
  const actions: Raw[] = overlay?.actions ?? []
  return current ?? actions.find((a) => a.likeButtonRenderer)?.likeButtonRenderer.likeStatus
}

/** Parses a radio continuation (`next` with `continuation`). */
export function parseWatchNextContinuation(raw: Raw): QueuePage {
  const panel = raw?.continuationContents?.playlistPanelContinuation
  const items = queueSongs(panel?.contents)
  const continuation = radioContinuation(panel)
  return continuation ? { items, continuation } : { items }
}

/** Parses the `MPLYt` lyrics browse. Returns undefined when the song has no lyrics. */
export function parseLyrics(raw: Raw): Lyrics | undefined {
  const sections: Raw[] = raw?.contents?.sectionListRenderer?.contents ?? []
  const shelf = sections.find((s) => s.musicDescriptionShelfRenderer)?.musicDescriptionShelfRenderer
  const body = text(shelf?.description).replace(/\r\n/g, '\n')
  if (!body) return undefined
  const source = text(shelf.footer)
  return source ? { text: body, source } : { text: body }
}

/** Parses the `MPTRt` related browse: carousels of related songs, artists and albums. */
export function parseRelated(raw: Raw): Shelf[] {
  return shelves(raw?.contents?.sectionListRenderer?.contents).filter((s) => s.items.length > 0)
}
