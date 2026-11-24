import type { Song } from '../api/models'
import { setLiked, useLiked, useWithoutRemoved, type PlaylistTarget } from '../actions'
import { Icon } from '../icons'
import { usePlayerStatus } from '../player/state'
import type { QueueSource } from '../queue'
import { Art } from './Art'
import { ArtistLinks, formatTime, playFrom, songMenu, useIsCurrent, useMenuTarget } from './items'
import { navigate } from '../nav/history'
import './TrackTable.css'

/**
 * Album tracks show plays; playlist tracks show art, artists and the album.
 * Pass `playlist` for a playlist the user owns, so its rows offer removal.
 */
export function TrackTable({ tracks: all, variant, source, playlist }: { tracks: Song[]; variant: 'album' | 'playlist'; source: QueueSource; playlist?: PlaylistTarget }) {
  const tracks = useWithoutRemoved(playlist?.playlistId, all)
  return (
    <section className={`tracks ${variant}`} role="table" aria-label="Tracks">
      <div className="track head" role="row">
        <span role="columnheader" className="track-n">#</span>
        <span role="columnheader">Title</span>
        <span role="columnheader">{variant === 'album' ? 'Plays' : 'Album'}</span>
        <span />
        <span role="columnheader" className="track-time">Time</span>
        <span />
      </div>
      {tracks.map((song, i) => (
        <TrackRow key={`${song.setVideoId ?? song.videoId}${i}`} song={song} n={i + 1} variant={variant} playlist={playlist} onPlay={() => playFrom(tracks, i, source)} />
      ))}
    </section>
  )
}

function TrackRow({ song, n, variant, playlist, onPlay }: { song: Song; n: number; variant: 'album' | 'playlist'; playlist?: PlaylistTarget; onPlay: () => void }) {
  const current = useIsCurrent(song)
  const playing = usePlayerStatus() === 'playing'
  const liked = useLiked(song)
  const target = useMenuTarget(song)
  const menu = songMenu(song, playlist)
  return (
    <div
      className={['track', !song.playable && 'off', target && 'target'].filter(Boolean).join(' ')}
      role="row"
      tabIndex={0}
      aria-current={current || undefined}
      onClick={onPlay}
      onKeyDown={(e) => e.key === 'Enter' && onPlay()}
      onContextMenu={menu}
    >
      <span className="track-n muted num">
        {current ? (
          <span className={playing ? 'eq playing' : 'eq'} aria-label="Now playing">
            <span />
            <span />
            <span />
          </span>
        ) : (
          n
        )}
      </span>
      <span className="track-title">
        {variant === 'playlist' && <Art thumbnails={song.thumbnails} size={36} />}
        <span className="track-text">
          <span className={current ? 't1 is-current' : 't1'}>
            {song.title}
            {song.explicit && <span className="e" aria-label="Explicit">E</span>}
          </span>
          {!song.playable ? (
            <span className="t2">Not available</span>
          ) : (
            variant === 'playlist' && (
              <span className="t2">
                <ArtistLinks artists={song.artists} />
              </span>
            )
          )}
        </span>
      </span>
      <span className="track-extra muted">
        {variant === 'album' ? (
          song.plays?.replace(/ plays$/, '')
        ) : song.album ? (
          <span
            role="link"
            tabIndex={0}
            className="link"
            onClick={(e) => {
              e.stopPropagation()
              navigate({ name: 'album', browseId: song.album!.browseId })
            }}
          >
            {song.album.name}
          </span>
        ) : null}
      </span>
      <button
        type="button"
        className={liked ? 'ib liked' : 'ib hover-only'}
        aria-label={liked ? `Unlike ${song.title}` : `Like ${song.title}`}
        aria-pressed={liked}
        onClick={(e) => {
          e.stopPropagation()
          void setLiked(song, !liked)
        }}
      >
        <Icon name="heart" size={16} filled={liked} />
      </button>
      <span className="track-time muted num">{formatTime(song.durationSec)}</span>
      <button type="button" className="ib hover-only" aria-label={`More options for ${song.title}`} onClick={menu}>
        <Icon name="more" size={16} />
      </button>
    </div>
  )
}
