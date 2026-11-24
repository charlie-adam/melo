// Shared helpers for the parsers. Renderer paths and fallbacks follow Kaset's parsers (MIT);
// the code is written fresh.
import type { AlbumRef, ArtistRef, BrowseLink, Item, LikeStatus, Shelf, Song, Thumbnail } from '../models'

/** Raw InnerTube JSON. Every read goes through optional chaining, so a missing field yields undefined. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Raw = any

const SEPARATOR = ' • '
const TYPE_LABELS = new Set(['Song', 'Video', 'Album', 'Single', 'EP', 'Playlist', 'Artist', 'Profile', 'Episode', 'Podcast'])
const ALBUM_TYPES = new Set(['Album', 'Single', 'EP'])

export function text(node: Raw): string {
  const runs: Raw[] = node?.runs ?? []
  return runs.map((r) => r.text ?? '').join('')
}

/** Splits runs on " • " into groups, dropping the separators. */
export function segments(runs: Raw[] = []): Raw[][] {
  const out: Raw[][] = [[]]
  for (const run of runs) {
    if (run.text === SEPARATOR) out.push([])
    else out[out.length - 1].push(run)
  }
  return out.filter((s) => s.length > 0)
}

export function parseDuration(value: string | undefined): number | undefined {
  if (!value || !/^\d+(:\d{2}){1,2}$/.test(value)) return undefined
  return value.split(':').reduce((total, part) => total * 60 + Number(part), 0)
}

export function thumbnails(node: Raw): Thumbnail[] {
  const list: Raw[] =
    node?.musicThumbnailRenderer?.thumbnail?.thumbnails ??
    node?.croppedSquareThumbnailRenderer?.thumbnail?.thumbnails ??
    node?.thumbnails ??
    []
  return list.map((t) => ({
    url: String(t.url).startsWith('//') ? `https:${t.url}` : t.url,
    width: t.width,
    height: t.height,
  }))
}

export function isExplicit(renderer: Raw): boolean {
  const badges: Raw[] = [...(renderer?.badges ?? []), ...(renderer?.subtitleBadges ?? [])]
  return badges.some((b) => b.musicInlineBadgeRenderer?.icon?.iconType === 'MUSIC_EXPLICIT_BADGE')
}

export function pageType(endpoint: Raw): string | undefined {
  return endpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType
}

export function browseLink(endpoint: Raw): BrowseLink | undefined {
  const browse = endpoint?.browseEndpoint
  if (!browse?.browseId) return undefined
  return browse.params ? { browseId: browse.browseId, params: browse.params } : { browseId: browse.browseId }
}

/** `MPLAUC...` (library artist) and `UC...` name the same artist. */
export function artistId(browseId: string): string {
  return browseId.startsWith('MPLAUC') ? browseId.slice(4) : browseId
}

function isArtistRun(run: Raw): boolean {
  const type = pageType(run.navigationEndpoint)
  const id: string = run.navigationEndpoint?.browseEndpoint?.browseId ?? ''
  if (type) return type === 'MUSIC_PAGE_TYPE_ARTIST' || type === 'MUSIC_PAGE_TYPE_USER_CHANNEL' || type === 'MUSIC_PAGE_TYPE_LIBRARY_ARTIST'
  return id.startsWith('UC') || id.startsWith('MPLAUC')
}

function isFiller(value: string): boolean {
  return TYPE_LABELS.has(value) || parseDuration(value) !== undefined || /^\d{4}$/.test(value) || /^[\d.,]+[KMB]? (plays|views)$/.test(value)
}

/**
 * Artists from subtitle runs: linked artist runs if any, else the names in the first segment that is not
 * a type label, duration, year or play count. Unlinked names get no browseId, so the UI never navigates to them.
 */
export function artists(runs: Raw[] = []): ArtistRef[] {
  const linked = runs.filter(isArtistRun)
  if (linked.length > 0) return linked.map((r) => ({ name: r.text, browseId: artistId(r.navigationEndpoint.browseEndpoint.browseId) }))
  const first = segments(runs).find((s) => !isFiller(text({ runs: s })))
  if (!first) return []
  return first
    .map((r) => r.text as string)
    .filter((name) => name !== ', ' && name !== ' & ')
    .map((name) => ({ name }))
}

export function album(runs: Raw[] = []): AlbumRef | undefined {
  const run = runs.find((r) => {
    const id: string = r.navigationEndpoint?.browseEndpoint?.browseId ?? ''
    return pageType(r.navigationEndpoint) === 'MUSIC_PAGE_TYPE_ALBUM' || id.startsWith('MPRE')
  })
  return run && { name: run.text, browseId: run.navigationEndpoint.browseEndpoint.browseId }
}

export function likeStatus(renderer: Raw): LikeStatus | undefined {
  const buttons: Raw[] = renderer?.menu?.menuRenderer?.topLevelButtons ?? []
  return buttons.find((b) => b.likeButtonRenderer)?.likeButtonRenderer.likeStatus
}

function isVideoType(watch: Raw): boolean {
  const type: string | undefined = watch?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType
  return type !== undefined && type !== 'MUSIC_VIDEO_TYPE_ATV'
}

function isEpisode(watch: Raw): boolean {
  return watch?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType === 'MUSIC_VIDEO_TYPE_PODCAST_EPISODE'
}

interface Parts {
  title: string
  subtitleRuns: Raw[]
  /** The item's own endpoint; a watchEndpoint makes it a song. */
  endpoint: Raw
  /** A watchEndpoint found elsewhere on the item, such as its play button. */
  watch?: Raw
  /** A playlist id from the play button, which for albums is the OLAK id. */
  playPlaylistId?: string
  thumbnails: Thumbnail[]
  explicit: boolean
}

/** Classifies an item by its endpoint: pageType first, then browse id prefix. Returns undefined for podcasts and anything else Melo does not show. */
function itemFromParts(p: Parts): Item | undefined {
  const subtitle = text({ runs: p.subtitleRuns })
  const watch = p.endpoint?.watchEndpoint ?? p.watch
  if (!p.endpoint?.browseEndpoint && watch?.videoId) {
    if (isEpisode(watch)) return undefined
    return {
      kind: 'song',
      videoId: watch.videoId,
      title: p.title,
      artists: artists(p.subtitleRuns),
      album: album(p.subtitleRuns),
      durationSec: segments(p.subtitleRuns).map((s) => parseDuration(text({ runs: s }))).find((d) => d !== undefined),
      thumbnails: p.thumbnails,
      explicit: p.explicit,
      isVideo: isVideoType(watch),
      playable: true,
    }
  }
  const browseId: string | undefined = p.endpoint?.browseEndpoint?.browseId
  if (!browseId) return undefined
  const type = pageType(p.endpoint)
  const prefixType = browseId.startsWith('MPRE')
    ? 'MUSIC_PAGE_TYPE_ALBUM'
    : /^(VL|PL|RD|OLAK)/.test(browseId)
      ? 'MUSIC_PAGE_TYPE_PLAYLIST'
      : /^(UC|MPLAUC)/.test(browseId)
        ? 'MUSIC_PAGE_TYPE_ARTIST'
        : undefined
  const segs = segments(p.subtitleRuns).map((s) => text({ runs: s }))
  switch (type ?? prefixType) {
    case 'MUSIC_PAGE_TYPE_ALBUM':
      return {
        kind: 'album',
        browseId,
        playlistId: p.playPlaylistId?.startsWith('OLAK') ? p.playPlaylistId : undefined,
        title: p.title,
        artists: artists(p.subtitleRuns).filter((a) => !ALBUM_TYPES.has(a.name)),
        albumType: segs.find((s) => ALBUM_TYPES.has(s)),
        year: segs.find((s) => /^\d{4}$/.test(s)),
        thumbnails: p.thumbnails,
        explicit: p.explicit,
        subtitle,
      }
    case 'MUSIC_PAGE_TYPE_PLAYLIST': {
      const authorSeg = segments(p.subtitleRuns).find((s) => !isFiller(text({ runs: s })) && !/ (songs|tracks|episodes)$/.test(text({ runs: s })))
      const authorRun = p.subtitleRuns.find(isArtistRun)
      const count = segs.map((s) => /^([\d,]+) (songs|tracks|episodes)$/.exec(s)).find((m) => m)
      return {
        kind: 'playlist',
        browseId: browseId.startsWith('VL') ? browseId : `VL${browseId}`,
        playlistId: browseId.startsWith('VL') ? browseId.slice(2) : browseId,
        title: p.title,
        author: authorRun
          ? { name: authorRun.text, browseId: authorRun.navigationEndpoint.browseEndpoint.browseId }
          : authorSeg && authorSeg.length === 1
            ? { name: authorSeg[0].text }
            : undefined,
        trackCount: count ? Number(count[1].replace(/,/g, '')) : undefined,
        thumbnails: p.thumbnails,
        subtitle,
      }
    }
    case 'MUSIC_PAGE_TYPE_ARTIST':
    case 'MUSIC_PAGE_TYPE_LIBRARY_ARTIST':
    case 'MUSIC_PAGE_TYPE_USER_CHANNEL':
      return {
        kind: type === 'MUSIC_PAGE_TYPE_USER_CHANNEL' ? 'profile' : 'artist',
        browseId: artistId(browseId),
        name: p.title,
        thumbnails: p.thumbnails,
        subtitle: segs.filter((s) => !TYPE_LABELS.has(s)).join(SEPARATOR),
      }
    default:
      return undefined
  }
}

function flexRuns(renderer: Raw, index: number): Raw[] {
  return renderer.flexColumns?.[index]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? []
}

/** Parses a `musicResponsiveListItemRenderer` row: songs in lists, and albums, playlists and artists in search. */
export function responsiveItem(renderer: Raw): Item | undefined {
  const titleRuns = flexRuns(renderer, 0)
  const restRuns: Raw[] = []
  for (let i = 1; i < (renderer.flexColumns?.length ?? 0); i++) {
    const runs = flexRuns(renderer, i)
    if (runs.length === 0) continue
    if (restRuns.length > 0) restRuns.push({ text: SEPARATOR })
    restRuns.push(...runs)
  }
  const overlayEndpoint = renderer.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint
  const videoId: string | undefined =
    renderer.playlistItemData?.videoId ?? titleRuns[0]?.navigationEndpoint?.watchEndpoint?.videoId ?? overlayEndpoint?.watchEndpoint?.videoId
  const watch = videoId
    ? { ...(titleRuns[0]?.navigationEndpoint?.watchEndpoint ?? overlayEndpoint?.watchEndpoint), videoId }
    : undefined
  const item = itemFromParts({
    title: text({ runs: titleRuns }),
    subtitleRuns: restRuns,
    endpoint: renderer.navigationEndpoint,
    watch,
    playPlaylistId: overlayEndpoint?.watchPlaylistEndpoint?.playlistId,
    thumbnails: thumbnails(renderer.thumbnail),
    explicit: isExplicit(renderer),
  })
  if (item?.kind !== 'song') return item
  const fixed = text(renderer.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text)
  const song: Song = {
    ...item,
    durationSec: parseDuration(fixed) ?? item.durationSec,
    playable: renderer.musicItemRendererDisplayPolicy !== 'MUSIC_ITEM_RENDERER_DISPLAY_POLICY_GREY_OUT',
  }
  const plays = restRuns.map((r) => r.text as string).find((t) => / plays$/.test(t))
  if (plays) song.plays = plays
  const setVideoId = renderer.playlistItemData?.playlistSetVideoId ?? removeSetVideoId(renderer)
  if (setVideoId) song.setVideoId = setVideoId
  const like = likeStatus(renderer)
  if (like) song.likeStatus = like
  return song
}

function removeSetVideoId(renderer: Raw): string | undefined {
  const items: Raw[] = renderer.menu?.menuRenderer?.items ?? []
  for (const item of items) {
    const actions: Raw[] = item.menuServiceItemRenderer?.serviceEndpoint?.playlistEditEndpoint?.actions ?? []
    const remove = actions.find((a) => a.action === 'ACTION_REMOVE_VIDEO' && a.setVideoId)
    if (remove) return remove.setVideoId
  }
  return undefined
}

/** Parses a `musicTwoRowItemRenderer` card. */
export function twoRowItem(renderer: Raw): Item | undefined {
  const play = renderer.thumbnailOverlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint
  return itemFromParts({
    title: text(renderer.title),
    subtitleRuns: renderer.subtitle?.runs ?? [],
    endpoint: renderer.navigationEndpoint,
    playPlaylistId: play?.watchPlaylistEndpoint?.playlistId ?? play?.watchEndpoint?.playlistId,
    thumbnails: thumbnails(renderer.thumbnailRenderer),
    explicit: isExplicit(renderer),
  })
}

/** Parses the top-result card in search. */
export function cardItem(card: Raw): Item | undefined {
  const titleRun = card.title?.runs?.[0]
  const endpoint = card.onTap ?? titleRun?.navigationEndpoint
  return itemFromParts({
    title: text(card.title),
    subtitleRuns: card.subtitle?.runs ?? [],
    endpoint,
    thumbnails: thumbnails(card.thumbnail),
    explicit: isExplicit(card),
  })
}

/** Parses whichever item renderer the wrapper holds. */
export function anyItem(wrapper: Raw): Item | undefined {
  if (wrapper.musicResponsiveListItemRenderer) return responsiveItem(wrapper.musicResponsiveListItemRenderer)
  if (wrapper.musicTwoRowItemRenderer) return twoRowItem(wrapper.musicTwoRowItemRenderer)
  return undefined
}

export function items(wrappers: Raw[] = []): Item[] {
  return wrappers.map(anyItem).filter((i): i is Item => i !== undefined)
}

export function songs(wrappers: Raw[] = []): Song[] {
  return items(wrappers).filter((i): i is Song => i.kind === 'song')
}

/**
 * The token on a trailing `continuationItemRenderer`, the newer continuation format. Some library pages wrap the
 * command in `commandExecutorCommand`.
 */
export function itemContinuation(wrappers: Raw[] = []): string | undefined {
  const endpoint = wrappers[wrappers.length - 1]?.continuationItemRenderer?.continuationEndpoint
  if (endpoint?.continuationCommand?.token) return endpoint.continuationCommand.token
  const commands: Raw[] = endpoint?.commandExecutorCommand?.commands ?? []
  return commands.find((c) => c.continuationCommand?.token)?.continuationCommand.token
}

/** The token in a renderer's `continuations` array, the older format. */
export function nextContinuation(renderer: Raw): string | undefined {
  return renderer?.continuations?.[0]?.nextContinuationData?.continuation
}

/** Parses a carousel, shelf or grid section into a shelf. Returns undefined for section types without items. */
export function shelf(section: Raw): Shelf | undefined {
  const carousel = section.musicCarouselShelfRenderer ?? section.musicImmersiveCarouselShelfRenderer
  if (carousel) {
    const header = carousel.header?.musicCarouselShelfBasicHeaderRenderer ?? carousel.header?.musicImmersiveCarouselShelfBasicHeaderRenderer
    const result: Shelf = { title: text(header?.title), items: items(carousel.contents) }
    const strapline = text(header?.strapline)
    if (strapline) result.strapline = strapline
    const more = browseLink(header?.moreContentButton?.buttonRenderer?.navigationEndpoint) ?? browseLink(header?.title?.runs?.[0]?.navigationEndpoint)
    if (more) result.more = more
    return result
  }
  const list = section.musicShelfRenderer
  if (list) {
    const result: Shelf = { title: text(list.title), items: items(list.contents) }
    const more = browseLink(list.bottomEndpoint) ?? browseLink(list.title?.runs?.[0]?.navigationEndpoint)
    if (more) result.more = more
    return result
  }
  const grid = section.gridRenderer
  if (grid) return { title: text(grid.header?.gridHeaderRenderer?.title), items: items(grid.items) }
  return undefined
}

export function shelves(sections: Raw[] = []): Shelf[] {
  return sections.map(shelf).filter((s): s is Shelf => s !== undefined)
}

/** Depth-first search for the first value under `key` anywhere in the tree. */
export function findKey(node: Raw, key: string): Raw {
  if (node === null || typeof node !== 'object') return undefined
  if (!Array.isArray(node) && key in node) return node[key]
  for (const child of Object.values(node)) {
    const found = findKey(child, key)
    if (found !== undefined) return found
  }
  return undefined
}

/** Depth-first search for the first string under any `playlistId` key that passes the test. */
export function findPlaylistId(node: Raw, test: (id: string) => boolean): string | undefined {
  if (node === null || typeof node !== 'object') return undefined
  if (!Array.isArray(node) && typeof node.playlistId === 'string' && test(node.playlistId)) return node.playlistId
  for (const child of Object.values(node)) {
    const found = findPlaylistId(child, test)
    if (found) return found
  }
  return undefined
}
