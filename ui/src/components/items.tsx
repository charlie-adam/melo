import type { MouseEvent, ReactNode } from 'react'
import type { PlaylistTarget } from '../actions'
import type { ArtistRef, Item, Song } from '../api/models'
import { Icon } from '../icons'
import { navigate } from '../nav/history'
import { playSongs, useQueue, type QueueSource } from '../queue'
import { toast } from '../toasts'
import { Art, PlaylistTile } from './Art'
import { openTrackMenu, useTrackMenu } from './menuState'
import './items.css'

export const dot = (parts: (string | undefined)[]) => parts.filter(Boolean).join(' · ')
const bullets = (text: string) => text.replaceAll(' • ', ' · ')

export const artistNames = (artists: ArtistRef[]) => artists.map((a) => a.name).join(', ')

export function formatTime(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return ''
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** The playable songs in random order. */
export function shuffled(songs: Song[]): Song[] {
  const out = songs.filter((s) => s.playable)
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** Plays `songs` from `index`, or says why the chosen song cannot play. */
export function playFrom(songs: Song[], index: number, source?: QueueSource) {
  const song = songs[index]
  if (!song.playable) return toast(`${song.title} isn't available.`)
  playSongs(songs, index, source)
}

export function openItem(item: Item) {
  if (item.kind === 'song') return playFrom([item], 0)
  if (item.kind === 'album') return navigate({ name: 'album', browseId: item.browseId })
  if (item.kind === 'playlist') return navigate({ name: 'playlist', browseId: item.browseId })
  navigate({ name: 'artist', browseId: item.browseId })
}

export function itemSubtitle(item: Item, withType = false): string {
  if (item.kind === 'song') return dot([withType ? (item.isVideo ? 'Video' : 'Song') : undefined, artistNames(item.artists), item.album?.name])
  if (item.kind === 'artist' || item.kind === 'profile') return dot([withType ? (item.kind === 'artist' ? 'Artist' : 'Profile') : undefined, item.subtitle]) || 'Artist'
  return bullets(item.subtitle)
}

export const itemTitle = (item: Item) => ('name' in item ? item.name : item.title)

export function songMenu(song: Song, playlist?: PlaylistTarget) {
  return (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (event.type === 'contextmenu') return openTrackMenu(song, event.clientX, event.clientY, playlist)
    const rect = event.currentTarget.getBoundingClientRect()
    openTrackMenu(song, rect.right, rect.bottom + 4, playlist)
  }
}

/** Artist names, each a link when it has a page. */
export function ArtistLinks({ artists }: { artists: ArtistRef[] }) {
  return artists.map((a, i) => (
    <span key={`${a.name}${i}`}>
      {i > 0 && ', '}
      {a.browseId ? (
        <span
          role="link"
          tabIndex={0}
          className="link"
          onClick={(e) => {
            e.stopPropagation()
            navigate({ name: 'artist', browseId: a.browseId! })
          }}
          onKeyDown={(e) => e.key === 'Enter' && navigate({ name: 'artist', browseId: a.browseId! })}
        >
          {a.name}
        </span>
      ) : (
        a.name
      )}
    </span>
  ))
}

/** True while the track menu is open for this song, so its row stays highlighted. */
export const useMenuTarget = (song: Song) => useTrackMenu()?.song === song

export function useIsCurrent(song: Song | undefined): boolean {
  return useQueue().current?.videoId === song?.videoId && song !== undefined
}

/** A grid card for an album, playlist, artist or song. */
export function Card({ item, onPlay }: { item: Item; onPlay?: () => void }) {
  const round = item.kind === 'artist' || item.kind === 'profile'
  return (
    <button
      type="button"
      className="card"
      onClick={() => (item.kind === 'song' && onPlay ? onPlay() : openItem(item))}
      onContextMenu={item.kind === 'song' ? songMenu(item) : undefined}
    >
      {item.kind === 'playlist' ? (
        <PlaylistTile playlist={item} size={160} fluid />
      ) : (
        <Art thumbnails={item.thumbnails} size={160} round={round} fluid style={round ? undefined : { borderRadius: 'var(--radius)' }} />
      )}
      <span className="card-text">
        <span className="t1">{itemTitle(item)}</span>
        <span className="t2">{itemSubtitle(item)}</span>
      </span>
    </button>
  )
}

/** A compact song row: art, title, subtitle, optional extra columns and a more button. */
export function SongRow({ song, onPlay, sub, art = 44, lead, extra }: { song: Song; onPlay: () => void; sub?: string; art?: number; lead?: ReactNode; extra?: ReactNode }) {
  const current = useIsCurrent(song)
  const target = useMenuTarget(song)
  return (
    <div
      className={['row', !song.playable && 'off', target && 'target'].filter(Boolean).join(' ')}
      role="button"
      tabIndex={0}
      onClick={onPlay}
      onKeyDown={(e) => e.key === 'Enter' && onPlay()}
      onContextMenu={songMenu(song)}
    >
      {lead}
      <Art thumbnails={song.thumbnails} size={art} />
      <span className="row-text">
        <span className={current ? 't1 is-current' : 't1'}>
          {song.title}
          {song.explicit && <span className="e" aria-label="Explicit">E</span>}
        </span>
        <span className="t2">{sub ?? dot([artistNames(song.artists), song.album?.name])}</span>
      </span>
      {extra}
      <button type="button" className="ib" aria-label={`More options for ${song.title}`} onClick={songMenu(song)}>
        <Icon name="more" size={16} />
      </button>
    </div>
  )
}
