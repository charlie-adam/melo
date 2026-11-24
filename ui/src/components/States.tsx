import type { ReactNode } from 'react'
import { signIn } from '../auth'
import { Icon, type IconName } from '../icons'
import './States.css'

/** Placeholder blocks shown while a page loads. */
export function PageSkeleton({ header = false }: { header?: boolean }) {
  return (
    <div className="skeleton" aria-busy="true" aria-label="Loading">
      {header && (
        <div className="sk-header">
          <div className="sk" style={{ width: 200, height: 200, borderRadius: 'var(--radius-md)' }} />
          <div className="sk-lines">
            <div className="sk" style={{ width: 90, height: 12 }} />
            <div className="sk" style={{ width: 320, height: 36 }} />
            <div className="sk" style={{ width: 200, height: 14 }} />
          </div>
        </div>
      )}
      <div className="sk" style={{ width: 140, height: 18 }} />
      <div className="sk-grid">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="sk" style={{ aspectRatio: '1' }} />
        ))}
      </div>
      <div className="sk" style={{ width: 110, height: 18, marginTop: 6 }} />
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="sk-row">
          <div className="sk" style={{ width: 40, height: 40 }} />
          <div className="sk-lines">
            <div className="sk" style={{ width: '40%', height: 12 }} />
            <div className="sk" style={{ width: '25%', height: 10 }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function EmptyState({ icon, title, text, action }: { icon: IconName; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={28} />
      <div className="empty-title">{title}</div>
      {text && <div className="empty-text">{text}</div>}
      {action}
    </div>
  )
}

export function LoadError({ retry }: { retry?: () => void }) {
  return (
    <EmptyState
      icon="offline"
      title="This page didn't load"
      text="Check your connection, then try again."
      action={
        retry && (
          <button type="button" className="btn" onClick={retry}>
            Try again
          </button>
        )
      }
    />
  )
}

export function OfflineBanner() {
  return (
    <div className="offline" role="status">
      <Icon name="offline" size={14} />
      You're offline. Reconnect to keep listening.
    </div>
  )
}

export function ExpiredBanner() {
  return (
    <div className="expired" role="alert">
      <div className="expired-text">
        <b>Your YouTube session ended.</b> Sign in again to keep browsing. Music that is playing keeps playing.
      </div>
      <div>
        <button type="button" className="btn primary" onClick={() => void signIn()}>
          Sign in again
        </button>
      </div>
    </div>
  )
}
