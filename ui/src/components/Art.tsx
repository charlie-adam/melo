import type { CSSProperties } from 'react'
import type { Playlist, Thumbnail } from '../api/models'
import { Icon } from '../icons'
import { artUrl } from '../images'

/** Square artwork. `size` is the rendered size in CSS pixels, used to pick a sharp image; `fluid` fills the width instead. */
export function Art({ thumbnails, size, round, fluid, style }: { thumbnails: Thumbnail[]; size: number; round?: boolean; fluid?: boolean; style?: CSSProperties }) {
  const url = artUrl(thumbnails, size)
  const box = fluid ? { width: '100%', aspectRatio: '1' } : { width: size, height: size }
  return (
    <span className={round ? 'art round' : 'art'} style={{ ...box, ...style }}>
      {url && <img src={url} alt="" loading="lazy" draggable={false} referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.hidden = true)} />}
    </span>
  )
}

/** Playlist artwork, with a heart tile for liked songs, which has no art of its own. */
export function PlaylistTile({ playlist, size, fluid }: { playlist: Playlist; size: number; fluid?: boolean }) {
  if (playlist.playlistId !== 'LM') return <Art thumbnails={playlist.thumbnails} size={size} fluid={fluid} style={fluid ? { borderRadius: 'var(--radius)' } : undefined} />
  const box = fluid ? { width: '100%', aspectRatio: '1', borderRadius: 'var(--radius)' } : { width: size, height: size }
  return (
    <span className="art liked-tile" style={box}>
      <Icon name="heart" size={Math.round(size * 0.4)} filled />
    </span>
  )
}
