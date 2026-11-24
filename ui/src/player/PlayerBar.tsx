import { useState } from 'react'
import { setLiked, useLikedNow } from '../actions'
import { request } from '../bridge/client'
import { Art } from '../components/Art'
import { ArtistLinks, formatTime, songMenu } from '../components/items'
import { Icon } from '../icons'
import { navigate } from '../nav/history'
import { cycleRepeat, next, previous, toggleShuffle, useQueue } from '../queue'
import { usePlayer } from './state'
import { openNowPlaying, toggleNowPlaying, useNowPlaying } from './view'
import './PlayerBar.css'

function Range({ label, value, max, step, onInput, onCommit, width }: { label: string; value: number; max: number; step: number; onInput: (v: number) => void; onCommit?: () => void; width?: number }) {
  const pct = max > 0 ? `${(Math.min(value, max) / max) * 100}%` : '0%'
  return (
    <input
      type="range"
      className="range"
      aria-label={label}
      min={0}
      max={max || 1}
      step={step}
      value={Math.min(value, max || 1)}
      disabled={max === 0}
      style={{ ['--pct' as string]: pct, width }}
      onChange={(e) => onInput(Number(e.target.value))}
      onPointerUp={onCommit}
      onKeyUp={onCommit}
    />
  )
}

export function PlayerBar() {
  const state = usePlayer()
  const { current, upNext, shuffle, repeat, autoplay } = useQueue()
  const view = useNowPlaying()
  const [scrub, setScrub] = useState<number>()
  const [unmuted, setUnmuted] = useState(1)

  const title = current?.title ?? state.title
  const thumbnails = current?.thumbnails ?? (state.artworkUrl ? [{ url: state.artworkUrl }] : [])
  const active = title !== undefined
  const liked = useLikedNow(current)
  const playing = state.status === 'playing' || state.status === 'loading'
  const time = scrub ?? state.currentTime

  return (
    <footer className="player">
      <div className="player-track">
        <button type="button" className="player-art" aria-label="Open now playing" disabled={!active} onClick={() => openNowPlaying('upnext')}>
          <Art thumbnails={thumbnails} size={48} />
        </button>
        <div className="player-text">
          {active ? (
            <>
              <span
                className={current?.album ? 't1 link' : 't1'}
                role={current?.album ? 'link' : undefined}
                onClick={() => current?.album && navigate({ name: 'album', browseId: current.album.browseId })}
                onContextMenu={current ? songMenu(current) : undefined}
              >
                {title}
              </span>
              <span className="t2">{current ? <ArtistLinks artists={current.artists} /> : state.artist}</span>
            </>
          ) : (
            <span className="t2">Nothing playing</span>
          )}
        </div>
        {current && (
          <button type="button" className={liked ? 'ib liked' : 'ib'} aria-label={liked ? 'Unlike' : 'Like'} aria-pressed={liked} onClick={() => void setLiked(current, !liked)}>
            <Icon name="heart" filled={liked} />
          </button>
        )}
      </div>

      <div className="player-center">
        <div className="player-controls">
          <button type="button" className="ib" aria-label="Shuffle" aria-pressed={shuffle} disabled={!active} onClick={toggleShuffle}>
            <Icon name="shuffle" size={17} />
          </button>
          <button type="button" className="ib strong" aria-label="Previous" disabled={!active} onClick={previous}>
            <Icon name="previous" />
          </button>
          <button type="button" className="play" aria-label={playing ? 'Pause' : 'Play'} disabled={!active} onClick={() => void request('player.toggle', {})}>
            <Icon name={playing ? 'pause' : 'play'} size={16} />
          </button>
          <button type="button" className="ib strong" aria-label="Next" disabled={!active || (upNext.length === 0 && repeat !== 'all' && !autoplay)} onClick={next}>
            <Icon name="next" />
          </button>
          <button type="button" className="ib repeat" aria-label={`Repeat: ${repeat}`} aria-pressed={repeat !== 'off'} disabled={!active} onClick={cycleRepeat}>
            <Icon name="repeat" size={17} />
            {repeat === 'one' && <span className="repeat-one">1</span>}
          </button>
        </div>
        <div className="player-progress muted num">
          <span className="time start">{active ? formatTime(time) : ''}</span>
          <Range
            label="Seek"
            value={time}
            max={state.duration}
            step={1}
            onInput={setScrub}
            onCommit={() => {
              if (scrub !== undefined) void request('player.seek', { seconds: scrub })
              setScrub(undefined)
            }}
          />
          <span className="time">{active ? formatTime(state.duration) : ''}</span>
        </div>
      </div>

      <div className="player-tools">
        <button type="button" className="ib" aria-label="Lyrics" aria-pressed={view === 'lyrics'} disabled={!active} onClick={() => toggleNowPlaying('lyrics')}>
          <Icon name="lyrics" />
        </button>
        <button type="button" className="ib" aria-label="Up next" aria-pressed={view === 'upnext'} disabled={!active} onClick={() => toggleNowPlaying('upnext')}>
          <Icon name="queue" />
        </button>
        <button
          type="button"
          className="ib"
          aria-label={state.volume === 0 ? 'Unmute' : 'Mute'}
          onClick={() => {
            if (state.volume > 0) setUnmuted(state.volume)
            void request('player.setVolume', { volume: state.volume > 0 ? 0 : unmuted })
          }}
        >
          <Icon name={state.volume === 0 ? 'muted' : 'volume'} />
        </button>
        <Range label="Volume" value={state.volume} max={1} step={0.01} width={88} onInput={(volume) => void request('player.setVolume', { volume })} />
      </div>
    </footer>
  )
}
