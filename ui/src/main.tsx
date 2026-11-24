import '@fontsource-variable/figtree'
import './styles/tokens.css'
import './app.css'
import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { startAuth } from './auth'
import { followTheme, startSettings } from './settings'

// In a plain browser (Vite without the shell), answer bridge calls from fixtures. Production builds drop this branch.
const bridge = import.meta.env.DEV && !window.webkit?.messageHandlers?.melo ? import('./dev/fixtureBridge') : Promise.resolve()

// The menu bar panel and the mini player load this bundle at #menubar and #mini. Each page imports only its
// own modules, so the queue's radio fetching runs in the main window alone.
const page = location.hash.slice(1)

void bridge.then(async () => {
  // Follow the theme setting, and the system appearance when it is System, by toggling the .dark tokens.
  startSettings()
  followTheme()
  let root: ReactNode
  if (page === 'menubar' || page === 'mini') {
    const { MenuBarPage, MiniPlayerPage } = await import('./satellite/Satellite')
    root = page === 'menubar' ? <MenuBarPage /> : <MiniPlayerPage />
  } else {
    const { App } = await import('./App')
    startAuth()
    root = <App />
  }
  createRoot(document.getElementById('root')!).render(<StrictMode>{root}</StrictMode>)
})
