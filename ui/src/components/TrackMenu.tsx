import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { addToPlaylist, newPlaylist, removeFromPlaylist, setLiked, useLiked, type PlaylistTarget } from '../actions'
import type { Song } from '../api/models'
import { parseContainingPlaylists } from '../api/parse/mutation'
import { addToPlaylistMenu } from '../api/requests'
import { Icon, type IconName } from '../icons'
import { useLibraryPlaylists } from '../library'
import { usePresence } from '../motion'
import { navigate } from '../nav/history'
import { addToQueue, playNext, startRadio } from '../queue'
import { toast } from '../toasts'
import { useApi } from '../useApi'
import { Art } from './Art'
import { closeTrackMenu, useTrackMenu } from './menuState'
import './TrackMenu.css'

const MARGIN = 8

/** Keeps a menu of the given size inside the window, flipping left or up when it would overflow. */
function place(x: number, y: number, width: number, height: number, flipX = x) {
  return {
    left: x + width > innerWidth - MARGIN ? Math.max(MARGIN, flipX - width) : x,
    top: Math.max(MARGIN, y + height > innerHeight - MARGIN ? innerHeight - MARGIN - height : y),
  }
}

function moveFocus(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  event.preventDefault()
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>('.mi:not(:disabled)')]
  const at = items.indexOf(document.activeElement as HTMLElement)
  const step = event.key === 'ArrowDown' ? 1 : -1
  items[(at + step + items.length) % items.length]?.focus()
}

function Item({ icon, label, onSelect }: { icon: IconName; label: string; onSelect: () => void }) {
  return (
    <button
      type="button"
      className="mi"
      role="menuitem"
      onClick={() => {
        closeTrackMenu()
        onSelect()
      }}
    >
      <Icon name={icon} size={16} />
      <span className="mi-label">{label}</span>
    </button>
  )
}

export function TrackMenu() {
  const { shown: request, leaving, done } = usePresence(useTrackMenu())
  if (!request) return null
  // Keyed by song and position so a new request starts with fresh placement and a closed submenu.
  return <Menu key={`${request.song.videoId}${request.x},${request.y}`} song={request.song} x={request.x} y={request.y} playlist={request.playlist} leaving={leaving} done={done} />
}

/** Grows from the corner nearest the point it opened at, which is the click unless the menu flipped. */
const origin = (x: number, y: number, at: { left: number; top: number }) => `${x - at.left}px ${y - at.top}px`

function Menu({ song, x, y, playlist, leaving, done }: { song: Song; x: number; y: number; playlist?: PlaylistTarget; leaving: boolean; done: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y, ready: false })
  const [sub, setSub] = useState<{ left: number; top: number; x: number; y: number }>()
  const subRef = useRef<HTMLDivElement>(null)
  const playlists = useLibraryPlaylists().filter((p) => p.playlistId !== 'LM')
  const liked = useLiked(song)
  // Marks the playlists that already hold the song. Fetched once the submenu opens; until then nothing is marked.
  const containing = useApi(sub ? addToPlaylistMenu(song.videoId) : null, parseContainingPlaylists).data
  const artist = song.artists.find((a) => a.browseId)

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && closeTrackMenu()
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

  useLayoutEffect(() => {
    const el = ref.current!
    setPos({ ...place(x, y, el.offsetWidth, el.offsetHeight), ready: true })
    el.querySelector<HTMLElement>('.mi')?.focus()
  }, [x, y])

  useLayoutEffect(() => {
    const el = subRef.current
    if (!sub || !el) return
    const next = place(sub.left, sub.top, el.offsetWidth, el.offsetHeight, pos.left + 4)
    if (next.left !== sub.left || next.top !== sub.top) setSub({ ...sub, ...next })
  }, [sub, pos.left])

  const openSub = (target: HTMLElement) => {
    const rect = target.getBoundingClientRect()
    setSub({ left: rect.right + 4, top: rect.top - 6, x: rect.right + 4, y: rect.top - 6 })
  }

  return (
    <div
      className={leaving ? 'menu-layer leaving' : 'menu-layer'}
      onAnimationEnd={(e) => leaving && e.target === e.currentTarget && done()}
      onMouseDown={(e) => e.target === e.currentTarget && closeTrackMenu()}
      onContextMenu={(e) => {
        e.preventDefault()
        closeTrackMenu()
      }}
      onWheel={closeTrackMenu}
    >
      <div
        ref={ref}
        className="menu"
        role="menu"
        aria-label={`${song.title} options`}
        style={{ left: pos.left, top: pos.top, visibility: pos.ready ? 'visible' : 'hidden', transformOrigin: origin(x, y, pos) }}
        onKeyDown={moveFocus}
      >
        <Item icon="playNext" label="Play next" onSelect={() => playNext(song)} />
        <Item icon="addToQueue" label="Add to queue" onSelect={() => addToQueue(song)} />
        <Item icon="radio" label="Start radio" onSelect={() => void startRadio(song.videoId).catch(() => toast("Couldn't start radio."))} />
        <div className="sep" />
        <button
          type="button"
          className={sub ? 'mi hot' : 'mi'}
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={sub !== undefined}
          onMouseEnter={(e) => openSub(e.currentTarget)}
          onClick={(e) => openSub(e.currentTarget)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') {
              openSub(e.currentTarget)
              requestAnimationFrame(() => subRef.current?.querySelector<HTMLElement>('.mi:not(:disabled)')?.focus())
            }
          }}
        >
          <Icon name="plus" size={16} />
          Add to playlist
          <span className="k">
            <Icon name="forward" size={14} />
          </span>
        </button>
        <div onMouseEnter={() => setSub(undefined)}>
          <Item icon="heart" label={liked ? 'Remove from Liked songs' : 'Add to Liked songs'} onSelect={() => void setLiked(song, !liked)} />
          {playlist && song.setVideoId && <Item icon="close" label={`Remove from ${playlist.title}`} onSelect={() => void removeFromPlaylist(song, playlist)} />}
          {(song.album || artist) && <div className="sep" />}
          {song.album && <Item icon="album" label="Go to album" onSelect={() => navigate({ name: 'album', browseId: song.album!.browseId })} />}
          {artist && <Item icon="artist" label="Go to artist" onSelect={() => navigate({ name: 'artist', browseId: artist.browseId! })} />}
          <div className="sep" />
          <Item
            icon="link"
            label="Copy link"
            onSelect={() =>
              void navigator.clipboard.writeText(`https://music.youtube.com/watch?v=${song.videoId}`).then(
                () => toast('Link copied'),
                () => toast("Couldn't copy the link."),
              )
            }
          />
        </div>
      </div>

      {sub && (
        <div
          ref={subRef}
          className="menu sub"
          role="menu"
          aria-label="Add to playlist"
          style={{ left: sub.left, top: sub.top, transformOrigin: origin(sub.x, sub.y, sub) }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') {
              e.stopPropagation()
              setSub(undefined)
              ref.current?.querySelector<HTMLElement>('[aria-haspopup]')?.focus()
            } else moveFocus(e)
          }}
        >
          <Item icon="plus" label="New playlist…" onSelect={() => void newPlaylist(song)} />
          {playlists.length > 0 && <div className="sep" />}
          <div className="sub-list">
            {playlists.map((p) => (
              <button
                key={p.playlistId}
                type="button"
                className="mi"
                role="menuitem"
                disabled={containing?.has(p.playlistId)}
                onClick={() => {
                  closeTrackMenu()
                  void addToPlaylist(song, p)
                }}
              >
                <Art thumbnails={p.thumbnails} size={20} style={{ borderRadius: 'var(--radius-xs)' }} />
                <span className="mi-label">{p.title}</span>
                {containing?.has(p.playlistId) && <span className="k">Added</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
