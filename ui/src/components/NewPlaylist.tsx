import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { closeNewPlaylist, createPlaylist, failureText, useNewPlaylistDialog } from '../actions'
import type { Song } from '../api/models'
import type { Privacy } from '../api/requests'
import { trapFocus } from './trapFocus'
import './NewPlaylist.css'

const VISIBILITY: { value: Privacy; label: string }[] = [
  { value: 'PRIVATE', label: 'Private' },
  { value: 'UNLISTED', label: 'Unlisted' },
  { value: 'PUBLIC', label: 'Public' },
]

export function NewPlaylistDialog() {
  const request = useNewPlaylistDialog()
  return request ? <Dialog song={request.song} /> : null
}

function Dialog({ song }: { song?: Song }) {
  const [title, setTitle] = useState('')
  const [privacy, setPrivacy] = useState<Privacy>('PRIVATE')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const group = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && closeNewPlaylist()
    addEventListener('keydown', onKey)
    return () => {
      removeEventListener('keydown', onKey)
      opener?.focus()
    }
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim() || busy) return
    setBusy(true)
    setError(undefined)
    try {
      await createPlaylist(title.trim(), privacy, song)
      closeNewPlaylist()
    } catch (err) {
      setError(failureText('create the playlist', err))
      setBusy(false)
    }
  }

  // Arrow keys move the choice, as in a native radio group; only the chosen option is a Tab stop.
  const onRadioKey = (event: KeyboardEvent) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    event.preventDefault()
    const at = VISIBILITY.findIndex((v) => v.value === privacy)
    const next = (at + step + VISIBILITY.length) % VISIBILITY.length
    setPrivacy(VISIBILITY[next].value)
    group.current?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus()
  }

  return (
    <div className="dialog-layer" onMouseDown={(e) => e.target === e.currentTarget && closeNewPlaylist()}>
      <form className="dialog" role="dialog" aria-modal="true" aria-labelledby="new-playlist-title" onSubmit={(e) => void submit(e)} onKeyDown={trapFocus}>
        <h2 id="new-playlist-title" className="dialog-title">
          New playlist
        </h2>
        <label className="dialog-field">
          Title
          <span className="field">
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} autoFocus />
          </span>
        </label>
        <div className="dialog-field">
          <span id="new-playlist-visibility">Visibility</span>
          <div ref={group} className="seg dialog-seg" role="radiogroup" aria-labelledby="new-playlist-visibility" onKeyDown={onRadioKey}>
            {VISIBILITY.map((v) => (
              <button key={v.value} type="button" role="radio" aria-checked={privacy === v.value} tabIndex={privacy === v.value ? 0 : -1} onClick={() => setPrivacy(v.value)}>
                {v.label}
              </button>
            ))}
          </div>
        </div>
        {song && <p className="dialog-note">{song.title} will be its first song.</p>}
        {error && (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={closeNewPlaylist}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!title.trim() || busy}>
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  )
}
