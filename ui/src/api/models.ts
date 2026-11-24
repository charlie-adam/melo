// Plain models the screens render. The parsers in ./parse turn raw InnerTube JSON into these.

export interface Thumbnail {
  url: string
  width?: number
  height?: number
}

/** A link to an artist, uploader or playlist author. `browseId` is absent when the run was not a link. */
export interface ArtistRef {
  name: string
  browseId?: string
}

export interface AlbumRef {
  name: string
  browseId: string
}

export type LikeStatus = 'LIKE' | 'DISLIKE' | 'INDIFFERENT'

export interface Song {
  kind: 'song'
  videoId: string
  title: string
  artists: ArtistRef[]
  album?: AlbumRef
  durationSec?: number
  thumbnails: Thumbnail[]
  explicit: boolean
  /** True for music videos and uploads (OMV, UGC), false for audio tracks (ATV). */
  isVideo: boolean
  /** False when YouTube Music greys the row out. The response gives no reason text. */
  playable: boolean
  likeStatus?: LikeStatus
  /** Identifies this row inside a playlist; needed to remove it. */
  setVideoId?: string
  /** Display text such as "2.4B plays". */
  plays?: string
}

export interface Album {
  kind: 'album'
  /** `MPREb_...`, for navigation. */
  browseId: string
  /** `OLAK5uy_...`, for save, remove and queueing. Not derivable from `browseId`. */
  playlistId?: string
  title: string
  artists: ArtistRef[]
  /** "Album", "Single" or "EP" when the subtitle says so. */
  albumType?: string
  year?: string
  thumbnails: Thumbnail[]
  explicit: boolean
  subtitle: string
}

export interface Playlist {
  kind: 'playlist'
  /** `VL...`, for browse. */
  browseId: string
  /** The id without `VL`, for mutations and queueing. */
  playlistId: string
  title: string
  author?: ArtistRef
  trackCount?: number
  thumbnails: Thumbnail[]
  subtitle: string
}

export interface Artist {
  /** `profile` is a user channel rather than an artist. */
  kind: 'artist' | 'profile'
  /** Always a `UC...` id; library `MPLAUC...` ids are mapped to it. */
  browseId: string
  name: string
  thumbnails: Thumbnail[]
  /** Display text such as "206M monthly audience". */
  subtitle: string
}

export type Item = Song | Album | Playlist | Artist

export interface BrowseLink {
  browseId: string
  params?: string
}

export interface Shelf {
  title: string
  strapline?: string
  items: Item[]
  /** Where the shelf's "More" button or title link goes. */
  more?: BrowseLink
}

export interface HomeChip {
  label: string
  /** Params for `browse FEmusic_home`. */
  params: string
}

export interface Home {
  shelves: Shelf[]
  continuation?: string
}

export interface TopResult {
  item: Item
  /** Songs and videos the card lists under the main result. */
  contents: Item[]
}

export interface SearchSection {
  /** Absent in the unfiltered results, where items arrive one per untitled section. */
  title?: string
  items: Item[]
}

export interface SearchFilter {
  label: string
  /** Send exactly as given, including any `%3D`, as the web client does. */
  params: string
}

export interface SearchResults {
  topResult?: TopResult
  sections: SearchSection[]
  filters: SearchFilter[]
  /** Only filtered searches page. */
  continuation?: string
}

export interface SearchPage {
  items: Item[]
  continuation?: string
}

export interface Suggestions {
  queries: string[]
  items: Item[]
}

export interface AlbumPage {
  album: Album
  description?: string
  /** Display text such as "12 songs • 53 minutes". */
  secondSubtitle?: string
  tracks: Song[]
  shelves: Shelf[]
  /** From the header's library button; absent when the response has none. */
  saved?: boolean
}

export interface PlaylistPage {
  playlist: Playlist
  description?: string
  secondSubtitle?: string
  tracks: Song[]
  continuation?: string
  saved?: boolean
  /** The signed-in account owns it, so rows can be removed. */
  editable?: boolean
}

export interface TracksPage {
  tracks: Song[]
  continuation?: string
}

export interface ArtistPage {
  artist: Artist
  description?: string
  /** The channel id the subscribe call takes, which can differ from `artist.browseId`. */
  channelId?: string
  subscribed: boolean
  /** Playlist id of the artist mix (`RDEM...`). */
  radioPlaylistId?: string
  shufflePlaylistId?: string
  shelves: Shelf[]
}

export interface LibraryPage {
  items: Item[]
  continuation?: string
}

export interface WatchNext {
  items: Song[]
  /** The radio playlist, when the response gives one (`RDAMVM...`). */
  playlistId?: string
  continuation?: string
  lyricsBrowseId?: string
  relatedBrowseId?: string
  likeStatus?: LikeStatus
}

export interface QueuePage {
  items: Song[]
  continuation?: string
}

export interface Lyrics {
  text: string
  /** Such as "Source: LyricFind". */
  source?: string
}
