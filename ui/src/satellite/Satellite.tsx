// The menu bar panel (#menubar) and the mini player (#mini): small pages in their own web views that follow the same
// `queue.changed` and `player.state` events as the main window. They import nothing that fetches on its own, so
// autoplay radio stays the main window's job.
import { useEffect } from 'react'
import { setLiked, useLiked } from '../actions'
import type { Song } from '../api/models'
import { parseWatchNext } from '../api/parse/watch'
import { next as watchNext } from '../api/requests'
import { on, request } from '../bridge/client'
import type { QueueItem, QueueSnapshot } from '../bridge/protocol'
import { Art } from '../components/Art'
import { formatTime } from '../components/items'
import { Icon } from '../icons'
import { usePlayer } from '../player/state'
import { setSetting } from '../settings'
import { createStore, useStore } from '../store'
import { useApi } from '../useApi'
import './Satellite.css'

/** The playing entry and the one after it. */
export function nowAndNext(snapshot: QueueSnapshot): { current?: QueueItem; upNext?: QueueItem } {
  return { current: snapshot.items[snapshot.index]?.item, upNext: snapshot.items[snapshot.index + 1]?.item }
}

const queue = createStore<{ current?: QueueItem; upNext?: QueueItem }>({})
on('queue.changed', (snapshot) => queue.set(nowAndNext(snapshot)))
request('queue.get', {}).then(
  (snapshot) => queue.set(nowAndNext(snapshot)),
  () => {},
)

function toSong(item: QueueItem): Song {
  return {
    kind: 'song',
    videoId: item.videoId,
    title: item.title,
    artists: item.artists,
    album: item.album,
    durationSec: item.durationSec,
    thumbnails: item.thumbnailUrl ? [{ url: item.thumbnailUrl }] : [],
    explicit: false,
    isVideo: item.isVideo ?? false,
    playable: true,
  }
}

const artists = (item?: QueueItem) => item?.artists.map((a) => a.name).join(', ') ?? ''
const percent = (time: number, duration: number) => `${duration > 0 ? Math.min(100, (time / duration) * 100) : 0}%`
const showWindow = () => void request('app.showWindow', {})

function Progress({ thin }: { thin?: boolean }) {
  const { currentTime, duration } = usePlayer()
  return (
    <div className={thin ? 'sat-bar thin' : 'sat-bar'}>
      <div style={{ width: percent(currentTime, duration) }} />
    </div>
  )
}

/** The like button. The queue holds no like status, so it comes from `next`, as on music.youtube.com. */
function Like({ item }: { item?: QueueItem }) {
  const watch = useApi(item ? watchNext(item.videoId) : null, parseWatchNext).data
  const song = item && { ...toSong(item), likeStatus: watch?.likeStatus }
  const liked = useLiked(song)
  return (
    <button type="button" className="ib" aria-label={liked ? 'Unlike' : 'Like'} aria-pressed={liked} disabled={!song || !watch} onClick={() => song && void setLiked(song, !liked)}>
      <Icon name="heart" size={17} filled={liked} />
    </button>
  )
}

export function MenuBarPage() {
  const { current, upNext } = useStore(queue)
  const state = usePlayer()
  const playing = state.status === 'playing' || state.status === 'loading'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || (e.key !== 'o' && e.key !== 'q')) return
      e.preventDefault()
      void request(e.key === 'o' ? 'app.showWindow' : 'app.quit', {})
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="mb" role="dialog" aria-label="Now playing">
      <div className="mb-track">
        <Art thumbnails={current?.thumbnailUrl ? [{ url: current.thumbnailUrl }] : []} size={56} />
        <div className="sat-text">
          <div className="sat-title">{current?.title ?? 'Nothing playing'}</div>
          <div className="sat-sub">{current ? [artists(current), current.album?.name].filter(Boolean).join(' · ') : 'Play something in Melo'}</div>
        </div>
      </div>
      <div className="mb-time">
        <span>{current ? formatTime(state.currentTime) : '0:00'}</span>
        <Progress />
        <span>{formatTime(state.duration || current?.durationSec || 0)}</span>
      </div>
      <div className="mb-controls">
        <Like item={current} />
        <button type="button" className="ib" aria-label="Previous" disabled={!current} onClick={() => void request('queue.previous', {})}>
          <Icon name="previous" />
        </button>
        <button type="button" className="mb-play" aria-label={playing ? 'Pause' : 'Play'} disabled={!current} onClick={() => void request('player.toggle', {})}>
          <Icon name={playing ? 'pause' : 'play'} size={16} />
        </button>
        <button type="button" className="ib" aria-label="Next" disabled={!current} onClick={() => void request('queue.next', {})}>
          <Icon name="next" />
        </button>
        <button type="button" className="ib" aria-label="Open mini player" onClick={() => void setSetting('miniPlayer', true)}>
          <Icon name="mini" size={17} />
        </button>
      </div>
      <div className="mb-next">{upNext ? `Up next: ${upNext.title}` : 'Nothing up next'}</div>
      <div className="mb-menu">
        <button type="button" className="mb-row" onClick={showWindow}>
          Open Melo<span>⌘O</span>
        </button>
        <button type="button" className="mb-row" onClick={() => void request('app.quit', {})}>
          Quit Melo<span>⌘Q</span>
        </button>
      </div>
    </div>
  )
}

export function MiniPlayerPage() {
  const { current } = useStore(queue)
  const state = usePlayer()
  const playing = state.status === 'playing' || state.status === 'loading'
  return (
    <div className="mini" role="dialog" aria-label="Mini player">
      <Art thumbnails={current?.thumbnailUrl ? [{ url: current.thumbnailUrl }] : []} size={118} />
      <div className="mini-body">
        <div className="sat-text">
          <div className="sat-title">{current?.title ?? 'Nothing playing'}</div>
          <div className="sat-sub">{artists(current)}</div>
        </div>
        <div className="mini-controls">
          <button type="button" className="ib" aria-label="Previous" disabled={!current} onClick={() => void request('queue.previous', {})}>
            <Icon name="previous" size={16} />
          </button>
          <button type="button" className="ib" aria-label={playing ? 'Pause' : 'Play'} disabled={!current} onClick={() => void request('player.toggle', {})}>
            <Icon name={playing ? 'pause' : 'play'} size={16} />
          </button>
          <button type="button" className="ib" aria-label="Next" disabled={!current} onClick={() => void request('queue.next', {})}>
            <Icon name="next" size={16} />
          </button>
          <button
            type="button"
            className="ib mini-expand"
            aria-label="Back to full window"
            onClick={() => {
              showWindow()
              void setSetting('miniPlayer', false)
            }}
          >
            <Icon name="expand" size={16} />
          </button>
        </div>
        <Progress thin />
      </div>
    </div>
  )
}
