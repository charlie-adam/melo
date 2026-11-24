import { useEffect, useRef, useState } from 'react'
import { signOut, useAccount } from '../auth'
import type { Settings as SettingsValue, Theme } from '../bridge/protocol'
import { Art } from '../components/Art'
import { SegThumb } from '../components/SegThumb'
import { trapFocus } from '../components/trapFocus'
import { usePresence } from '../motion'
import { setAutoplay, useQueue } from '../queue'
import { setSetting, useSettings } from '../settings'
import './Settings.css'

const THEMES: { theme: Theme; label: string }[] = [
  { theme: 'system', label: 'System' },
  { theme: 'light', label: 'Light' },
  { theme: 'dark', label: 'Dark' },
]

function Switch({ title, text, on, onChange }: { title: string; text: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="box-item">
      <div className="box-text">
        <div className="box-title">{title}</div>
        <div className="box-desc">{text}</div>
      </div>
      <button type="button" className="switch" role="switch" aria-checked={on} aria-label={title} onClick={() => onChange(!on)}>
        <span />
      </button>
    </div>
  )
}

function SettingSwitch({ name, title, text }: { name: keyof Omit<SettingsValue, 'theme'>; title: string; text: string }) {
  const settings = useSettings()
  return <Switch title={title} text={text} on={settings[name]} onChange={(on) => void setSetting(name, on)} />
}

function Account({ onClose }: { onClose: () => void }) {
  const account = useAccount()
  const [confirming, setConfirming] = useState(false)
  return (
    <div className="box-item">
      {account?.photo.length ? (
        <Art thumbnails={account.photo} size={36} round />
      ) : (
        <span className="avatar big" aria-hidden="true">
          {account?.name.slice(0, 1).toUpperCase()}
        </span>
      )}
      <div className="box-text">
        <div className="box-title">{confirming ? 'Sign out of YouTube Music?' : (account?.name ?? 'Signed in')}</div>
        {confirming ? <div className="box-desc">This also clears the queue.</div> : account?.handle && <div className="box-desc">{account.handle}</div>}
      </div>
      {confirming ? (
        <div className="settings-actions">
          <button type="button" className="btn small" onClick={() => setConfirming(false)} autoFocus>
            Cancel
          </button>
          <button type="button" className="btn small danger" onClick={() => void signOut().then(onClose)}>
            Sign out
          </button>
        </div>
      ) : (
        <button type="button" className="btn small danger" onClick={() => setConfirming(true)}>
          Sign out
        </button>
      )}
    </div>
  )
}

/** The Settings sheet pops in over a dimmed window and fades out once closed. */
export function Settings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { shown, leaving, done } = usePresence(open || undefined)
  return shown ? <SettingsDialog leaving={leaving} done={done} onClose={onClose} /> : null
}

function SettingsDialog({ leaving, done, onClose }: { leaving: boolean; done: () => void; onClose: () => void }) {
  const { theme } = useSettings()
  const { autoplay } = useQueue()
  const dialog = useRef<HTMLDivElement>(null)
  // The dialog itself takes focus on open, so no control shows a ring until the keyboard moves to it.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    dialog.current?.focus()
    return () => opener?.focus()
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className={leaving ? 'overlay leaving' : 'overlay'}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onAnimationEnd={(e) => leaving && e.target === e.currentTarget && done()}
    >
      <div ref={dialog} className="settings" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabIndex={-1} onKeyDown={trapFocus}>
        <div className="settings-head">
          <h2 id="settings-title">Settings</h2>
          <button type="button" className="btn small" onClick={onClose}>
            Done
          </button>
        </div>
        <div className="settings-body">
          <div className="group">
            <div className="rail-label group-label">Account</div>
            <div className="box">
              <Account onClose={onClose} />
            </div>
          </div>

          <div className="group">
            <div className="rail-label group-label">Playback</div>
            <div className="box">
              <Switch title="Autoplay" text="Play similar songs when the queue ends" on={autoplay} onChange={setAutoplay} />
              <SettingSwitch name="lyricsFromLrclib" title="Lyrics from LRCLIB" text="Used when YouTube Music has no synced lyrics" />
            </div>
          </div>

          <div className="group">
            <div className="rail-label group-label">Appearance</div>
            <div className="box">
              <div className="box-item">
                <div className="box-text">
                  <div className="box-title">Theme</div>
                </div>
                <div className="seg" role="radiogroup" aria-label="Theme">
                  {THEMES.map((t) => (
                    <button key={t.theme} type="button" role="radio" aria-checked={theme === t.theme} onClick={() => void setSetting('theme', t.theme)}>
                      {t.label}
                    </button>
                  ))}
                  <SegThumb />
                </div>
              </div>
            </div>
          </div>

          <div className="group">
            <div className="rail-label group-label">macOS</div>
            <div className="box">
              <SettingSwitch name="menuBarItem" title="Menu bar item" text="Now playing and controls from the menu bar" />
              <SettingSwitch name="miniPlayer" title="Mini player" text="A small window that floats above others" />
              <SettingSwitch name="mediaKeys" title="Media keys" text="Play and pause from the keyboard, AirPods and Control Center" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
