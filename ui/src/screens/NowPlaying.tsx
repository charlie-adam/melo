import { useEffect, useState, type HTMLAttributes, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { setLiked, useLiked } from '../actions'
import type { Item, LikeStatus, Song } from '../api/models'
import { parseRelated, parseWatchNext } from '../api/parse/watch'
import { browse, next } from '../api/requests'
import { Art } from '../components/Art'
import { ArtistLinks, formatTime, itemSubtitle, itemTitle, openItem, playFrom, songMenu, SongRow } from '../components/items'
import { EmptyState } from '../components/States'
import { Icon } from '../icons'
import { navigate } from '../nav/history'
import { closeNowPlaying, openNowPlaying, type NowPlayingTab } from '../player/view'
import { jump, move, remove, setAutoplay, useQueue } from '../queue'
import { useApi } from '../useApi'
import { LyricsPanel } from './Lyrics'
import './NowPlaying.css'

const TABS: { tab: NowPlayingTab; label: string }[] = [
  { tab: 'upnext', label: 'Up next' },
  { tab: 'lyrics', label: 'Lyrics' },
  { tab: 'related', label: 'Related' },
]

export function NowPlaying({ tab }: { tab: NowPlayingTab }) {
  const { current } = useQueue()
  const watch = useApi(current ? next(current.videoId) : null, parseWatchNext).data

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeNowPlaying()
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="now" role="dialog" aria-label="Now playing">
      <section className="now-main">
        <div className="now-bar">
          <button type="button" className="ib" aria-label="Close now playing" onClick={closeNowPlaying}>
            <Icon name="down" />
          </button>
        </div>
        {current ? <Current song={current} likeStatus={watch?.likeStatus} /> : <EmptyState icon="queue" title="Nothing playing" text="Pick a song to play from anywhere in Melo." />}
      </section>
      <aside className="now-side">
        <div className="seg now-tabs" role="tablist" aria-label="Now playing panels">
          {TABS.map((t) => (
            <button key={t.tab} type="button" role="tab" aria-selected={t.tab === tab} onClick={() => openNowPlaying(t.tab)}>
              {t.label}
            </button>
          ))}
        </div>
        {tab === 'upnext' && <UpNext />}
        {tab === 'lyrics' && <LyricsPanel song={current} />}
        {tab === 'related' && <Related browseId={watch?.relatedBrowseId} loading={current !== undefined && watch === undefined} />}
      </aside>
    </div>
  )
}

function Current({ song, likeStatus }: { song: Song; likeStatus?: LikeStatus }) {
  // The queue's copy may carry no like status, so the parent's `next` response decides it.
  const liked = useLiked({ ...song, likeStatus: likeStatus ?? song.likeStatus })
  return (
    <div className="now-current">
      <Art thumbnails={song.thumbnails} size={420} style={{ width: 'var(--now-art)', height: 'var(--now-art)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-lg)' }} />
      <div className="now-info">
        <div className="now-text">
          <div className="now-title">{song.title}</div>
          <div className="muted now-sub">
            <ArtistLinks artists={song.artists} />
            {song.album && (
              <>
                {' · '}
                <span role="link" tabIndex={0} className="link" onClick={() => (closeNowPlaying(), navigate({ name: 'album', browseId: song.album!.browseId }))}>
                  {song.album.name}
                </span>
              </>
            )}
          </div>
        </div>
        <button type="button" className={liked ? 'ib big liked' : 'ib big'} aria-label={liked ? 'Unlike' : 'Like'} aria-pressed={liked} onClick={() => void setLiked(song, !liked)}>
          <Icon name="heart" size={20} filled={liked} />
        </button>
        <button type="button" className="ib big" aria-label="More options" onClick={songMenu(song)}>
          <Icon name="more" />
        </button>
      </div>
    </div>
  )
}

function QueueRow({ song, onPlay, current }: { song: Song; onPlay?: () => void; current?: boolean }) {
  return (
    <div className={current ? 'q current' : 'q'} role={onPlay ? 'button' : undefined} tabIndex={onPlay ? 0 : undefined} onClick={onPlay} onContextMenu={songMenu(song)}>
      <Art thumbnails={song.thumbnails} size={40} />
      <span className="row-text">
        <span className={current ? 't1 is-current' : 't1'}>{song.title}</span>
        <span className="t2">{song.artists.map((a) => a.name).join(', ')}</span>
      </span>
      <span className="row-aside">{formatTime(song.durationSec)}</span>
    </div>
  )
}

/** A song in Up next: click plays it, drag (or Alt+Up and Alt+Down) moves it, the close button or Delete removes it. */
function NextRow({ song, drop, onPlay, onRemove, onMove, drag }: { song: Song; drop?: 'before' | 'after'; onPlay: () => void; onRemove: () => void; onMove: (by: number) => void; drag: Pick<HTMLAttributes<HTMLDivElement>, 'onDragStart' | 'onDragOver' | 'onDrop' | 'onDragEnd'> }) {
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    const action =
      e.key === 'Enter' || e.key === ' '
        ? onPlay
        : e.key === 'Delete' || e.key === 'Backspace'
          ? onRemove
          : e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')
            ? () => onMove(e.key === 'ArrowUp' ? -1 : 1)
            : undefined
    if (!action) return
    e.preventDefault()
    action()
  }
  return (
    <div className={drop ? `q next drop-${drop}` : 'q next'} role="button" tabIndex={0} draggable onClick={onPlay} onKeyDown={onKeyDown} onContextMenu={songMenu(song)} {...drag}>
      <Art thumbnails={song.thumbnails} size={40} />
      <span className="row-text">
        <span className="t1">{song.title}</span>
        <span className="t2">{song.artists.map((a) => a.name).join(', ')}</span>
      </span>
      <span className="row-aside">{formatTime(song.durationSec)}</span>
      <button type="button" className="ib q-remove" aria-label={`Remove ${song.title} from the queue`} onClick={(e) => (e.stopPropagation(), onRemove())}>
        <Icon name="close" size={14} />
      </button>
    </div>
  )
}

function UpNext() {
  const { current, index, upNext, upNextIds, source, autoplay } = useQueue()
  // While dragging: the row being moved and the gap it would drop into (0 is before the first row).
  const [drag, setDrag] = useState<{ from: number; to: number }>()
  if (!current) return <EmptyState icon="queue" title="Queue is empty" text="Songs you play or add to the queue show up here." />
  const at = (i: number) => index + 1 + i
  // Dropping a row into the gap on either side of itself changes nothing.
  const moves = drag !== undefined && drag.to !== drag.from && drag.to !== drag.from + 1
  const drop = () => {
    if (drag && moves) move(at(drag.from), at(drag.to > drag.from ? drag.to - 1 : drag.to))
    setDrag(undefined)
  }
  // Autoplay sits below the scrolling list, so it stays in reach however long the queue is.
  return (
    <>
      <div className="now-panel queue-panel">
        <div className="queue-from">
          <span className="rail-label">Playing from</span>
          {source &&
            (source.route ? (
              <span role="link" tabIndex={0} className="queue-source link" onClick={() => (closeNowPlaying(), navigate(source.route!))}>
                {source.label}
              </span>
            ) : (
              <span className="queue-source">{source.label}</span>
            ))}
        </div>
        <QueueRow song={current} current />
        {upNext.length > 0 && <div className="rail-label queue-next">Next</div>}
        {upNext.map((song, i) => (
          <NextRow
            key={upNextIds[i]}
            song={song}
            drop={moves && drag.to === i ? 'before' : moves && drag.to === upNext.length && i === upNext.length - 1 ? 'after' : undefined}
            onPlay={() => jump(at(i))}
            onRemove={() => remove(at(i))}
            onMove={(by) => i + by >= 0 && i + by < upNext.length && move(at(i), at(i + by))}
            drag={{
              onDragStart: (e) => {
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', song.title)
                setDrag({ from: i, to: i })
              },
              onDragOver: (e) => {
                if (!drag) return
                e.preventDefault()
                const rect = e.currentTarget.getBoundingClientRect()
                const to = e.clientY < rect.top + rect.height / 2 ? i : i + 1
                if (to !== drag.to) setDrag({ ...drag, to })
              },
              onDrop: (e) => (e.preventDefault(), drop()),
              onDragEnd: () => setDrag(undefined),
            }}
          />
        ))}
      </div>
      <div className="autoplay">
        <span className="row-text">
          <span className="t1">Autoplay</span>
          <span className="t2">Similar songs play when the queue ends</span>
        </span>
        <button type="button" className="switch" role="switch" aria-checked={autoplay} aria-label="Autoplay" onClick={() => setAutoplay(!autoplay)}>
          <span />
        </button>
      </div>
    </>
  )
}

function ItemRow({ item }: { item: Item }) {
  return (
    <button type="button" className="q" onClick={() => (closeNowPlaying(), openItem(item))}>
      <Art thumbnails={item.thumbnails} size={40} round={item.kind === 'artist' || item.kind === 'profile'} />
      <span className="row-text">
        <span className="t1">{itemTitle(item)}</span>
        <span className="t2">{itemSubtitle(item, true)}</span>
      </span>
    </button>
  )
}

function Related({ browseId, loading }: { browseId?: string; loading: boolean }) {
  const { data, error } = useApi(browseId ? browse(browseId) : null, parseRelated)
  if (loading || (browseId && !data && !error)) return <div className="now-panel" aria-busy="true" />
  if (!data || data.length === 0) return <EmptyState icon="radio" title="Nothing related" text="YouTube Music has no related music for this song." />
  return (
    <div className="now-panel related">
      {data.map((shelf) => {
        const songs = shelf.items.filter((i): i is Song => i.kind === 'song')
        return (
          <section key={shelf.title} className="related-shelf">
            <h3 className="rail-label related-title">{shelf.title}</h3>
            {shelf.items.map((item, i) =>
              item.kind === 'song' ? (
                <SongRow key={i} song={item} art={40} onPlay={() => playFrom(songs, songs.indexOf(item), { label: shelf.title })} />
              ) : (
                <ItemRow key={i} item={item} />
              ),
            )}
          </section>
        )
      })}
    </div>
  )
}
