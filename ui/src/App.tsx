import { useEffect, useState } from 'react'
import { on, request } from './bridge/client'
import { loadAccount, useAuth } from './auth'
import { NewPlaylistDialog } from './components/NewPlaylist'
import { TrackMenu } from './components/TrackMenu'
import { ExpiredBanner, OfflineBanner } from './components/States'
import { Toasts } from './components/Toasts'
import { refreshLibraryPlaylists } from './library'
import { currentRoute, goBack, goForward, navigate, useHistory, type Route } from './nav/history'
import { PlayerBar } from './player/PlayerBar'
import { Rail } from './Rail'
import { ArtistScreen } from './screens/Artist'
import { AlbumScreen, PlaylistScreen } from './screens/Collection'
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

/**
 * Space plays and pauses, unless you are typing or moved focus with the keyboard, where Space presses the control.
 * A control focused by a mouse click doesn't count, so Space doesn't replay the row you just clicked.
 */
export function spacePlaysOrPauses(e: KeyboardEvent): boolean {
  if (e.key !== ' ' || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return false
  const target = e.target instanceof Element ? e.target : null
  if (target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return false
  return !target?.matches(':focus-visible')
}

/** Space to play and pause, Cmd-K for search, Cmd-[ and Cmd-] or the mouse side buttons for back and forward. */
function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (spacePlaysOrPauses(e)) {
        e.preventDefault()
        void request('player.toggle', {})
        return
      }
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

/** Back and forward live in the native title bar: tell Swift when they can go, and follow its clicks. */
function useTitlebarNavigation(canGoBack: boolean, canGoForward: boolean) {
  useEffect(() => {
    request('nav.state', { canGoBack, canGoForward }).catch(() => {})
  }, [canGoBack, canGoForward])
  useEffect(() => on('nav.go', ({ direction }) => (direction === 'back' ? goBack() : goForward())), [])
}

function Shell({ expired }: { expired: boolean }) {
  const history = useHistory()
  useTitlebarNavigation(history.index > 0, history.index < history.entries.length - 1)
  const route = history.entries[history.index]
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
        {!online && <OfflineBanner />}
        <div className="page" key={`${history.index}${JSON.stringify(route)}`}>
          {expired && <ExpiredBanner />}
          <div className={expired ? 'page-body dimmed' : 'page-body'}>
            <Screen route={route} />
          </div>
        </div>
      </main>
      <NowPlaying />
      <PlayerBar />
      <TrackMenu />
      <NewPlaylistDialog />
      <Toasts />
      <Settings open={settings} onClose={() => setSettings(false)} />
    </div>
  )
}

export function App() {
  const auth = useAuth()
  if (!auth) return null
  if (!auth.signedIn) return <SignIn />
  return <Shell expired={auth.expired} />
}
