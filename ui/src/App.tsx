import { useEffect, useState } from 'react'
import { loadAccount, useAuth } from './auth'
import { NewPlaylistDialog } from './components/NewPlaylist'
import { TrackMenu } from './components/TrackMenu'
import { ExpiredBanner, OfflineBanner } from './components/States'
import { Toasts } from './components/Toasts'
import { refreshLibraryPlaylists } from './library'
import { currentRoute, goBack, goForward, navigate, useHistory, type Route } from './nav/history'
import { PlayerBar } from './player/PlayerBar'
import { useNowPlaying } from './player/view'
import { Rail } from './Rail'
import { ArtistScreen } from './screens/Artist'
import { AlbumScreen, PlaylistScreen } from './screens/Collection'
import { Icon } from './icons'
import { Home } from './screens/Home'
import { LibraryScreen } from './screens/Library'
import { NowPlaying } from './screens/NowPlaying'
import { SearchScreen } from './screens/Search'
import { Settings } from './screens/Settings'
import { SignIn } from './screens/SignIn'
import './shell.css'

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case 'home':
      return <Home />
    case 'search':
      return <SearchScreen query={route.query} params={route.params} />
    case 'album':
      return <AlbumScreen browseId={route.browseId} />
    case 'playlist':
      return <PlaylistScreen browseId={route.browseId} />
    case 'artist':
      return <ArtistScreen browseId={route.browseId} />
    case 'library':
      return <LibraryScreen tab={route.tab} />
  }
}

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    addEventListener('online', update)
    addEventListener('offline', update)
    return () => {
      removeEventListener('online', update)
      removeEventListener('offline', update)
    }
  }, [])
  return online
}

/** Cmd-K for search, Cmd-[ and Cmd-] or the mouse side buttons for back and forward. */
function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey) return
      if (e.key === 'k') {
        e.preventDefault()
        if (currentRoute().name !== 'search') navigate({ name: 'search', query: '' })
        requestAnimationFrame(() => document.getElementById('search-input')?.focus())
      } else if (e.key === '[') goBack()
      else if (e.key === ']') goForward()
    }
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) goBack()
      if (e.button === 4) goForward()
    }
    addEventListener('keydown', onKey)
    addEventListener('mouseup', onMouse)
    return () => {
      removeEventListener('keydown', onKey)
      removeEventListener('mouseup', onMouse)
    }
  }, [])
}

function Shell({ expired }: { expired: boolean }) {
  const history = useHistory()
  const route = history.entries[history.index]
  const nowPlaying = useNowPlaying()
  const online = useOnline()
  const [settings, setSettings] = useState(false)
  useShortcuts()

  useEffect(() => {
    void loadAccount().catch(() => {})
    void refreshLibraryPlaylists().catch(() => {})
  }, [])

  return (
    <div className="app">
      <Rail onSettings={() => setSettings(true)} />
      <main className="main">
        <div className="page-nav">
          <button type="button" className="ib" aria-label="Back" disabled={history.index === 0} onClick={goBack}>
            <Icon name="back" />
          </button>
          <button type="button" className="ib" aria-label="Forward" disabled={history.index === history.entries.length - 1} onClick={goForward}>
            <Icon name="forward" />
          </button>
        </div>
        {!online && <OfflineBanner />}
        <div className="page" key={`${history.index}${JSON.stringify(route)}`}>
          {expired && <ExpiredBanner />}
          <div className={expired ? 'page-body dimmed' : 'page-body'}>
            <Screen route={route} />
          </div>
        </div>
      </main>
      {nowPlaying && <NowPlaying tab={nowPlaying} />}
      <PlayerBar />
      <TrackMenu />
      <NewPlaylistDialog />
      <Toasts />
      {settings && <Settings onClose={() => setSettings(false)} />}
    </div>
  )
}

export function App() {
  const auth = useAuth()
  if (!auth) return null
  if (!auth.signedIn) return <SignIn />
  return <Shell expired={auth.expired} />
}
