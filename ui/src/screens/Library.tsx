import { useMemo } from 'react'
import type { Item, Song } from '../api/models'
import { parsePlaylistContinuation, parsePlaylistPage } from '../api/parse/collection'
import { parseLibrary, parseLibraryContinuation } from '../api/parse/library'
import { browseContinuation, libraryAlbums, libraryArtists, libraryPlaylists, likedSongs, type ApiRequest } from '../api/requests'
import { Sentinel } from '../components/Sentinel'
import { CardGrid } from '../components/Shelf'
import { EmptyState, LoadError, PageSkeleton } from '../components/States'
import { TrackTable } from '../components/TrackTable'
import type { IconName } from '../icons'
import { replaceRoute, type LibraryTab } from '../nav/history'
import { useReconciled, type ListName } from '../library'
import { useApi, usePaged } from '../useApi'
import './Library.css'

const TABS: { tab: LibraryTab; label: string; request: () => ApiRequest; empty: [IconName, string, string] }[] = [
  { tab: 'playlists', label: 'Playlists', request: libraryPlaylists, empty: ['library', 'No playlists', 'Playlists you make or save on any device show up here.'] },
  { tab: 'albums', label: 'Albums', request: libraryAlbums, empty: ['album', 'No saved albums', 'Albums you save on any device show up here.'] },
  { tab: 'artists', label: 'Artists', request: libraryArtists, empty: ['artist', 'No artists', 'Artists you subscribe to or save songs from show up here.'] },
  { tab: 'songs', label: 'Songs', request: likedSongs, empty: ['heart', 'No liked songs', 'Songs you like on any device show up here.'] },
]

export function LibraryScreen({ tab }: { tab: LibraryTab }) {
  const current = TABS.find((t) => t.tab === tab)!
  return (
    <div className="screen library">
      <h1 className="page-title">Library</h1>
      <div className="seg" role="tablist" aria-label="Library">
        {TABS.map((t) => (
          <button key={t.tab} type="button" role="tab" aria-selected={t.tab === tab} onClick={() => replaceRoute({ name: 'library', tab: t.tab })}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'songs' ? <LikedSongs empty={current.empty} /> : <Grid key={tab} request={current.request()} list={tab === 'artists' ? undefined : tab} empty={current.empty} />}
    </div>
  )
}

const parseMore = (raw: unknown) => parseLibraryContinuation(raw)

/** `list` names the library list whose pending changes to show; artists have none. */
function Grid({ request, list, empty }: { request: ApiRequest; list?: ListName; empty: [IconName, string, string] }) {
  const { data, error } = useApi(request, parseLibrary)
  const paged = usePaged<Item>(data, browseContinuation, parseMore)
  const { token, more } = paged
  const items = useReconciled(list, paged.items)
  if (error) return <LoadError />
  if (!data) return <PageSkeleton />
  if (items.length === 0) return <EmptyState icon={empty[0]} title={empty[1]} text={empty[2]} />
  return (
    <>
      <CardGrid items={items} />
      {token && <Sentinel onVisible={more} />}
    </>
  )
}

const parseMoreSongs = (raw: unknown) => {
  const page = parsePlaylistContinuation(raw)
  return { items: page.tracks, continuation: page.continuation }
}

function LikedSongs({ empty }: { empty: [IconName, string, string] }) {
  const { data, error } = useApi(likedSongs(), (raw) => parsePlaylistPage(raw, 'VLLM'))
  const first = useMemo(() => data && { items: data.tracks, continuation: data.continuation }, [data])
  const paged = usePaged<Song>(first, browseContinuation, parseMoreSongs)
  const { token, more } = paged
  const items = useReconciled('songs', paged.items)
  if (error) return <LoadError />
  if (!data) return <PageSkeleton />
  if (items.length === 0) return <EmptyState icon={empty[0]} title={empty[1]} text={empty[2]} />
  return (
    <>
      <TrackTable tracks={items} variant="playlist" source={{ label: data.playlist.title, route: { name: 'playlist', browseId: 'VLLM' } }} />
      {token && <Sentinel onVisible={more} />}
    </>
  )
}
