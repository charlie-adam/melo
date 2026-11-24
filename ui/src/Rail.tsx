import { newPlaylist } from './actions'
import { useAccount } from './auth'
import { Art, PlaylistTile } from './components/Art'
import { Icon, type IconName } from './icons'
import { useLibraryPlaylists } from './library'
import { navigate, useHistory, type Route } from './nav/history'
import './Rail.css'

const nav: { route: Route; label: string; icon: IconName }[] = [
  { route: { name: 'home' }, label: 'Home', icon: 'home' },
  { route: { name: 'search', query: '' }, label: 'Search', icon: 'search' },
  { route: { name: 'library', tab: 'playlists' }, label: 'Library', icon: 'library' },
]

export function Rail({ onSettings }: { onSettings: () => void }) {
  const history = useHistory()
  const route = history.entries[history.index]
  const playlists = useLibraryPlaylists()
  const account = useAccount()

  return (
    <aside className="rail">
      <div className="rail-account">
        {account?.photo.length ? (
          <Art thumbnails={account.photo} size={32} round />
        ) : (
          <span className="avatar" aria-hidden="true">
            {account?.name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="rail-account-text">
          <span className="rail-account-name">{account?.name ?? 'Signed in'}</span>
          {account?.handle && <span className="rail-account-sub">{account.handle}</span>}
        </div>
        <button type="button" className="ib" aria-label="Settings" onClick={onSettings}>
          <Icon name="settings" />
        </button>
      </div>

      <nav className="rail-nav">
        {nav.map((item) => (
          <button
            key={item.label}
            type="button"
            className="nav-item"
            aria-current={route.name === item.route.name ? 'page' : undefined}
            onClick={() => navigate(item.route.name === 'search' && route.name === 'search' ? route : item.route)}
          >
            <Icon name={item.icon} />
            <span className="nav-label">{item.label}</span>
            {item.icon === 'search' && <span className="nav-key">⌘K</span>}
          </button>
        ))}
      </nav>

      <div className="rail-head">
        <h2 className="rail-label">Playlists</h2>
        <button type="button" className="ib small" aria-label="New playlist" onClick={() => void newPlaylist()}>
          <Icon name="plus" size={16} />
        </button>
      </div>
      <div className="rail-playlists">
        {playlists.map((p) => (
          <button
            key={p.playlistId}
            type="button"
            className="rail-playlist"
            aria-current={route.name === 'playlist' && route.browseId === p.browseId ? 'page' : undefined}
            onClick={() => navigate({ name: 'playlist', browseId: p.browseId })}
          >
            <PlaylistTile playlist={p} size={28} />
            <span className="rail-playlist-name">{p.title}</span>
          </button>
        ))}
      </div>
    </aside>
  )
}
