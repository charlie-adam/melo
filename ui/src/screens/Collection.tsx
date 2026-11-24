import { useMemo, type ReactNode } from 'react'
import { setSaved, useSaved } from '../actions'
import type { Album, Playlist, Song, Thumbnail } from '../api/models'
import { parseAlbumPage, parsePlaylistContinuation, parsePlaylistPage } from '../api/parse/collection'
import { album, browseContinuation, playlist } from '../api/requests'
import { Art, PlaylistTile } from '../components/Art'
import { ArtistLinks, dot, playFrom, shuffled } from '../components/items'
import { Sentinel } from '../components/Sentinel'
import { Shelf } from '../components/Shelf'
import { EmptyState, LoadError, PageSkeleton } from '../components/States'
import { TrackTable } from '../components/TrackTable'
import { Icon } from '../icons'
import type { Route } from '../nav/history'
import type { QueueSource } from '../queue'
import { useApi, usePaged } from '../useApi'
import './Collection.css'

const bullets = (text: string | undefined) => text?.replaceAll(' • ', ' · ')

function Header({ art, kind, title, byline, item, saved: fromServer = false, canSave, tracks, source }: { art: ReactNode; kind: string; title: string; byline: ReactNode; item: Album | Playlist; saved?: boolean; canSave: boolean; tracks: Song[]; source: QueueSource }) {
  const first = tracks.findIndex((t) => t.playable)
  const saved = useSaved(item, fromServer)
  return (
    <header className="collection-header">
      {art}
      <div className="collection-meta">
        <div className="collection-kind">{kind}</div>
        <h1 className="collection-title">{title}</h1>
        <div className="collection-byline">{byline}</div>
        <div className="collection-actions">
          <button type="button" className="btn primary" disabled={first < 0} onClick={() => playFrom(tracks, first, source)}>
            <Icon name="play" size={14} />
            Play
          </button>
          <button type="button" className="btn" disabled={first < 0} onClick={() => playFrom(shuffled(tracks), 0, source)}>
            <Icon name="shuffle" size={15} />
            Shuffle
          </button>
          {canSave && (
            <button type="button" className="btn" aria-pressed={saved} disabled={!item.playlistId} onClick={() => void setSaved(item, !saved, fromServer)}>
              <Icon name={saved ? 'check' : 'plus'} size={15} />
              {saved ? 'In library' : 'Save to library'}
            </button>
          )}
        </div>
      </div>
    </header>
  )
}

function bigArt(thumbnails: Thumbnail[]) {
  return <Art thumbnails={thumbnails} size={200} style={{ borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow)' }} />
}

export function AlbumScreen({ browseId }: { browseId: string }) {
  const { data, error } = useApi(album(browseId), (raw) => parseAlbumPage(raw, browseId))
  if (error) return <LoadError />
  if (!data) return <PageSkeleton header />
  const a = data.album
  const route: Route = { name: 'album', browseId }
  return (
    <div className="screen collection">
      <Header
        art={bigArt(a.thumbnails)}
        kind={dot([a.albumType ?? 'Album', a.year])}
        title={a.title}
        byline={
          <>
            <span className="strong">
              <ArtistLinks artists={a.artists} />
            </span>
            {data.secondSubtitle && <span className="muted"> · {bullets(data.secondSubtitle)}</span>}
          </>
        }
        item={a}
        saved={data.saved}
        canSave
        tracks={data.tracks}
        source={{ label: a.title, route }}
      />
      {data.tracks.length > 0 ? <TrackTable tracks={data.tracks} variant="album" source={{ label: a.title, route }} /> : <EmptyState icon="album" title="No tracks" />}
      {data.shelves.map((shelf) => (
        <Shelf key={shelf.title} shelf={shelf} />
      ))}
    </div>
  )
}

const parseMore = (raw: unknown) => {
  const page = parsePlaylistContinuation(raw)
  return { items: page.tracks, continuation: page.continuation }
}

export function PlaylistScreen({ browseId }: { browseId: string }) {
  const { data, error } = useApi(playlist(browseId), (raw) => parsePlaylistPage(raw, browseId))
  const first = useMemo(() => data && { items: data.tracks, continuation: data.continuation }, [data])
  const { items: tracks, token, more } = usePaged<Song>(first, browseContinuation, parseMore)
  if (error) return <LoadError />
  if (!data) return <PageSkeleton header />
  const p = data.playlist
  const source = { label: p.title, route: { name: 'playlist', browseId } as Route }
  const kind = p.playlistId === 'LM' ? 'Auto playlist' : (bullets(p.subtitle) ?? 'Playlist')
  return (
    <div className="screen collection">
      <Header
        art={p.playlistId === 'LM' ? <PlaylistTile playlist={p} size={200} /> : bigArt(p.thumbnails)}
        kind={kind}
        title={p.title}
        byline={
          <>
            {p.author && (
              <span className="strong">
                <ArtistLinks artists={[p.author]} />
              </span>
            )}
            {data.secondSubtitle && (
              <span className="muted">
                {p.author ? ' · ' : ''}
                {bullets(data.secondSubtitle)}
              </span>
            )}
          </>
        }
        item={p}
        saved={data.saved}
        canSave={p.playlistId !== 'LM' && !data.editable}
        tracks={tracks}
        source={source}
      />
      {tracks.length > 0 ? (
        <TrackTable tracks={tracks} variant="playlist" source={source} playlist={data.editable && p.playlistId !== 'LM' ? p : undefined} />
      ) : (
        <EmptyState icon="library" title="No songs yet" text="Songs you add to this playlist show up here." />
      )}
      {token && <Sentinel onVisible={more} />}
    </div>
  )
}
