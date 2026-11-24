import { beforeEach, describe, expect, it, vi } from 'vitest'
import { on, request } from './bridge/client'
import type { Settings } from './bridge/protocol'
import { applyTheme, DEFAULT_SETTINGS, setSetting, settings, startSettings } from './settings'

// The real bridge client needs a browser window.
vi.mock('./bridge/client', () => ({ request: vi.fn(), on: vi.fn() }))
const requestMock = vi.mocked(request)
const onMock = vi.mocked(on)

beforeEach(() => {
  settings.set(DEFAULT_SETTINGS)
  requestMock.mockReset()
})

describe('settings store', () => {
  it('loads from Swift and follows settings.changed', async () => {
    const saved: Settings = { ...DEFAULT_SETTINGS, theme: 'dark', miniPlayer: true }
    requestMock.mockResolvedValue(saved)
    startSettings()
    expect(requestMock).toHaveBeenCalledWith('settings.get', {})
    await vi.waitFor(() => expect(settings.get()).toEqual(saved))
    const listener = onMock.mock.calls.find(([name]) => name === 'settings.changed')![1] as (s: Settings) => void
    listener({ ...saved, mediaKeys: false })
    expect(settings.get().mediaKeys).toBe(false)
  })

  it('sets one field optimistically and keeps what Swift answers', async () => {
    let resolve!: (s: Settings) => void
    requestMock.mockReturnValue(new Promise((r) => (resolve = r as (s: Settings) => void)))
    const done = setSetting('lyricsFromLrclib', false)
    expect(settings.get().lyricsFromLrclib).toBe(false)
    expect(requestMock).toHaveBeenCalledWith('settings.set', { lyricsFromLrclib: false })
    resolve({ ...DEFAULT_SETTINGS, lyricsFromLrclib: false })
    await done
    expect(settings.get()).toEqual({ ...DEFAULT_SETTINGS, lyricsFromLrclib: false })
  })

  it('rolls back when Swift refuses', async () => {
    requestMock.mockRejectedValue(new Error('Invalid'))
    await setSetting('theme', 'light')
    expect(settings.get().theme).toBe('system')
  })
})

describe('applyTheme', () => {
  const root = () => {
    const names = new Set<string>()
    return { classList: { toggle: (n: string, on: boolean) => (on ? names.add(n) : names.delete(n), on) } as unknown as DOMTokenList, names }
  }
  it.each([
    ['system', false, false],
    ['system', true, true],
    ['light', true, false],
    ['dark', false, true],
  ] as const)('%s with a dark system %s is dark: %s', (theme, systemDark, dark) => {
    const r = root()
    applyTheme(r, theme, systemDark)
    expect(r.names.has('dark')).toBe(dark)
  })
})
