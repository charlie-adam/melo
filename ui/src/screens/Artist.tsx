import { setSubscribed, useSubscribed } from '../actions'
import { call } from '../api/call'
import type { Artist, ArtistPage, Item, Song } from '../api/models'
import { parseArtistPage } from '../api/parse/artist'
import { parseWatchNext } from '../api/parse/watch'
import { artist, watchPlaylist } from '../api/requests'
import { Art } from '../components/Art'
import { formatTime, itemSubtitle, openItem, playFrom, SongRow } from '../components/items'
import { Shelf } from '../components/Shelf'
import { LoadError, PageSkeleton } from '../components/States'
import { Icon } from '../icons'
import { navigate } from '../nav/history'
import { playSongs, type QueueSource } from '../queue'
import { toast } from '../toasts'
import { useApi } from '../useApi'
import './Artist.css'

async function playPlaylist(playlistId: string, source: QueueSource) {
  try {
    const watch = parseWatchNext(await call(watchPlaylist(playlistId)))
    if (watch.items.length > 0) playSongs(watch.items, 0, source)
  } catch {
    toast("Couldn't start playback.")
  }
}

function SubscribeButton({ page }: { page: ArtistPage }) {
  const subscribed = useSubscribed(page)
  return (
    <button type="button" className="btn" aria-pressed={subscribed} onClick={() => void setSubscribed(page, !subscribed)}>
      {subscribed ? 'Subscribed' : 'Subscribe'}
    </button>
  )
}

export function ArtistScreen({ browseId }: { browseId: string }) {
  const { data, error } = useApi(artist(browseId), (raw) => parseArtistPage(raw, browseId))
  if (error) return <LoadError />
  if (!data) return <PageSkeleton header />
  const a = data.artist
  const source = { label: a.name, route: { name: 'artist', browseId } as const }
  const songsShelf = data.shelves.find((s) => s.items.length > 0 && s.items.every((i) => i.kind === 'song') && s.items.some((i) => i.kind === 'song' && !i.isVideo))
  const top = (songsShelf?.items ?? []) as Song[]
  const similarShelf = data.shelves.find((s) => s.items.every((i) => i.kind === 'artist'))
  const similar = (similarShelf?.items ?? []) as Artist[]
  const rest = data.shelves.filter((s) => s !== songsShelf && s !== similarShelf)

  return (
    <div className="screen artist">
      <header className="artist-header">
        <Art thumbnails={a.thumbnails} size={168} round style={{ boxShadow: 'var(--shadow)' }} />
        <div className="artist-meta">
          <div className="collection-kind">Artist</div>
          <h1 className="artist-name">{a.name}</h1>
          {a.subtitle && <div className="muted artist-sub">{a.subtitle}</div>}
          <div className="collection-actions">
            {data.shufflePlaylistId && (
              <button type="button" className="btn primary" onClick={() => void playPlaylist(data.shufflePlaylistId!, source)}>
                <Icon name="shuffle" size={15} />
                Shuffle
              </button>
            )}
            {data.radioPlaylistId && (
              <button type="button" className="btn" onClick={() => void playPlaylist(data.radioPlaylistId!, { label: `${a.name} radio` })}>
                <Icon name="radio" size={15} />
                Radio
              </button>
            )}
            {data.channelId && (
              <SubscribeButton page={data} />
            )}
          </div>
        </div>
      </header>

      {(top.length > 0 || similar.length > 0) && (
        <div className="artist-top">
          <section className="section artist-songs">
            <div className="section-head">
              <h2 className="h2">{songsShelf?.title ?? 'Top songs'}</h2>
              {songsShelf?.more && (
                <button type="button" className="btn small" onClick={() => navigate({ name: 'playlist', browseId: songsShelf.more!.browseId })}>
                  Show all
                </button>
              )}
            </div>
            <div>
              {top.slice(0, 5).map((song, i) => (
                <SongRow
                  key={song.videoId}
                  song={song}
                  art={40}
                  onPlay={() => playFrom(top, i, source)}
                  sub={song.album?.name ?? itemSubtitle(song)}
                  lead={<span className="artist-n muted num">{i + 1}</span>}
                  extra={
                    <>
                      <span className="row-aside" style={{ width: 64 }}>
                        {song.plays?.replace(/ plays$/, '')}
                      </span>
                      {song.durationSec !== undefined && (
                        <span className="row-aside" style={{ width: 40 }}>
                          {formatTime(song.durationSec)}
                        </span>
                      )}
                    </>
                  }
                />
              ))}
            </div>
          </section>
          {similar.length > 0 && (
            <section className="section">
              <div className="section-head">
                <h2 className="h2">{similarShelf!.title}</h2>
              </div>
              <div>
                {similar.slice(0, 5).map((s) => (
                  <ArtistRow key={s.browseId} item={s} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {rest.map((shelf) => (
        <Shelf key={shelf.title} shelf={shelf} />
      ))}
    </div>
  )
}

function ArtistRow({ item }: { item: Item & Artist }) {
  return (
    <button type="button" className="row artist-row" onClick={() => openItem(item)}>
      <Art thumbnails={item.thumbnails} size={40} round />
      <span className="row-text">
        <span className="t1">{item.name}</span>
        <span className="t2">{item.subtitle || 'Artist'}</span>
      </span>
    </button>
  )
}
