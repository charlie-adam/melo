// Settings live in Swift (UserDefaults), so the main window, the menu bar page and the mini player all read the same
// values. This store mirrors them: it loads with `settings.get`, follows `settings.changed`, and applies changes
// optimistically, rolling back if Swift refuses.
import { on, request } from './bridge/client'
import type { Settings, Theme } from './bridge/protocol'
import { createStore, useStore } from './store'

export const DEFAULT_SETTINGS: Settings = { theme: 'system', lyricsFromLrclib: true, menuBarItem: true, miniPlayer: false, mediaKeys: true }

export const settings = createStore<Settings>(DEFAULT_SETTINGS)

export function startSettings() {
  on('settings.changed', (value) => settings.set(value))
  request('settings.get', {}).then(
    (value) => settings.set(value),
    () => {},
  )
}

export async function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
  const before = settings.get()
  settings.set({ ...before, [key]: value })
  try {
    settings.set(await request('settings.set', { [key]: value }))
  } catch {
    settings.set(before)
  }
}

export const useSettings = () => useStore(settings)

/** Puts `.dark` on <html> for the chosen theme, following the system when the theme is `system`. */
export function applyTheme(root: { classList: DOMTokenList }, theme: Theme, systemDark: boolean) {
  root.classList.toggle('dark', theme === 'dark' || (theme === 'system' && systemDark))
}

/** Keeps <html> in step with the theme setting and, for `system`, with the system appearance. */
export function followTheme() {
  const dark = window.matchMedia('(prefers-color-scheme: dark)')
  const update = () => applyTheme(document.documentElement, settings.get().theme, dark.matches)
  update()
  dark.addEventListener('change', update)
  settings.subscribe(update)
}
