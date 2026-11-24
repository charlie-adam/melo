import type { Album, AlbumPage, Playlist, PlaylistPage, Song, TracksPage } from '../models'
import {
  artists,
  findKey,
  findPlaylistId,
  itemContinuation,
  nextContinuation,
  segments,
  shelves,
  songs,
  text,
  thumbnails,
  type Raw,
} from './common'

/** The current responsive header, or the older detail header (also found inside the editable header of your own playlists). */
function header(raw: Raw): Raw {
  return findKey(raw?.contents, 'musicResponsiveHeaderRenderer') ?? findKey(raw?.header, 'musicDetailHeaderRenderer') ?? {}
}

/** Section list holding the tracks: the second column in the current layout, the only column in the older one. */
function trackSections(raw: Raw): Raw[] {
  return (
    raw?.contents?.twoColumnBrowseResultsRenderer?.secondaryContents?.sectionListRenderer?.contents ??
    raw?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents ??
    []
  )
}

const LIBRARY_ICONS = ['BOOKMARK_BORDER', 'LIBRARY_ADD']

/** Whether the header's library toggle is on, or undefined when the header has none. */
function saved(h: Raw): boolean | undefined {
  const buttons: Raw[] = [...(h.buttons ?? []), ...(h.menu?.menuRenderer?.topLevelButtons ?? [])]
  const toggle = buttons.map((b) => b.toggleButtonRenderer).find((t) => LIBRARY_ICONS.includes(t?.defaultIcon?.iconType))
  return toggle ? toggle.isToggled === true : undefined
}

function description(h: Raw): string | undefined {
  return text(h.description?.musicDescriptionShelfRenderer?.description) || text(h.description) || undefined
}

function headerThumbnails(h: Raw) {
  return thumbnails(h.thumbnail)
}

/** Parses an album page (`browse` with an `MPREb_` id). Album rows carry no artist or art, so they inherit the album's. */
export function parseAlbumPage(raw: Raw, browseId: string): AlbumPage {
  const h = header(raw)
  const subtitleRuns: Raw[] = h.subtitle?.runs ?? []
  const segs = segments(subtitleRuns).map((s) => text({ runs: s }))
  const art = headerThumbnails(h)
  const byline = artists(h.straplineTextOne?.runs ?? subtitleRuns).filter((a) => !['Album', 'Single', 'EP'].includes(a.name))
  const sections = trackSections(raw)
  const trackShelf = sections.find((s) => s.musicShelfRenderer)?.musicShelfRenderer
  const tracks = songs(trackShelf?.contents)
  const album: Album = {
    kind: 'album',
    browseId,
    playlistId: findPlaylistId(h, isOlak) ?? findPlaylistId(raw, isOlak),
    title: text(h.title),
    artists: byline,
    albumType: segs.find((s) => ['Album', 'Single', 'EP'].includes(s)),
    year: segs.find((s) => /^\d{4}$/.test(s)),
    thumbnails: art,
    explicit: tracks.some((t) => t.explicit),
    subtitle: text(h.subtitle),
  }
  const ref = { name: album.title, browseId }
  const page: AlbumPage = {
    album,
    tracks: tracks.map((t): Song => ({
      ...t,
      artists: t.artists.length > 0 ? t.artists : byline,
      album: t.album ?? ref,
      thumbnails: t.thumbnails.length > 0 ? t.thumbnails : art,
    })),
    shelves: shelves(sections.filter((s) => !s.musicShelfRenderer)).filter((s) => s.items.length > 0),
  }
  const desc = description(h)
  if (desc) page.description = desc
  const second = text(h.secondSubtitle)
  if (second) page.secondSubtitle = second
  const inLibrary = saved(h)
  if (inLibrary !== undefined) page.saved = inLibrary
  return page
}

function isOlak(id: string): boolean {
  return id.startsWith('OLAK')
}

/**
 * Parses a playlist page (`browse` with a `VL` id, including `VLLM` liked songs).
 * Tracks come from `musicPlaylistShelfRenderer`, else the first `musicShelfRenderer` not titled "Suggestions".
 * The section-level continuation pages into suggestions, so only the shelf's own token is returned.
 */
export function parsePlaylistPage(raw: Raw, browseId: string): PlaylistPage {
  const h = header(raw)
  const shelf =
    findKey(raw?.contents, 'musicPlaylistShelfRenderer') ??
    trackSections(raw).find((s) => s.musicShelfRenderer && text(s.musicShelfRenderer.title) !== 'Suggestions')?.musicShelfRenderer
  const second = text(h.secondSubtitle)
  const count = /([\d,]+) (songs|tracks|episodes)/.exec(second || text(h.subtitle))
  const playlist: Playlist = {
    kind: 'playlist',
    browseId,
    playlistId: browseId.startsWith('VL') ? browseId.slice(2) : browseId,
    title: text(h.title),
    author: author(h),
    trackCount: count ? Number(count[1].replace(/,/g, '')) : undefined,
    thumbnails: headerThumbnails(h),
    subtitle: text(h.subtitle),
  }
  const page: PlaylistPage = { playlist, tracks: songs(shelf?.contents) }
  const desc = description(h)
  if (desc) page.description = desc
  if (second) page.secondSubtitle = second
  const inLibrary = saved(h)
  if (inLibrary !== undefined) page.saved = inLibrary
  if (findKey(raw?.contents, 'musicEditablePlaylistDetailHeaderRenderer')) page.editable = true
  const continuation = itemContinuation(shelf?.contents) ?? nextContinuation(shelf)
  if (continuation) page.continuation = continuation
  return page
}

function author(h: Raw): Playlist['author'] {
  const facepile = h.facepile?.avatarStackViewModel
  const name: string | undefined = facepile?.text?.content
  if (name) {
    const id: string | undefined = facepile.rendererContext?.commandContext?.onTap?.innertubeCommand?.browseEndpoint?.browseId
    return id ? { name, browseId: id } : { name }
  }
  const byline = artists(h.straplineTextOne?.runs ?? [])
  if (byline.length > 0) return byline[0]
  const linked = (h.subtitle?.runs ?? []).find((r: Raw) => r.navigationEndpoint?.browseEndpoint?.browseId?.startsWith('UC'))
  return linked ? { name: linked.text, browseId: linked.navigationEndpoint.browseEndpoint.browseId } : undefined
}

/** Parses a playlist continuation, in either the append-action or the older shelf-continuation format. */
export function parsePlaylistContinuation(raw: Raw): TracksPage {
  const actions: Raw[] = raw?.onResponseReceivedActions ?? []
  const appended: Raw[] = actions.flatMap((a) => a.appendContinuationItemsAction?.continuationItems ?? [])
  const shelf = raw?.continuationContents?.musicPlaylistShelfContinuation
  const wrappers = shelf ? shelf.contents : appended
  const continuation = itemContinuation(wrappers) ?? nextContinuation(shelf)
  const tracks = songs(wrappers)
  return continuation ? { tracks, continuation } : { tracks }
}
