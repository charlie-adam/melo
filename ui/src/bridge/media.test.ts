import { beforeAll, describe, expect, it, vi } from 'vitest'
import { contentSecurityPolicy } from '../../vite.config'
import type { Event, LrclibResult, Settings } from './protocol'

// The client installs window.melo when it loads, so window exists before the import.
const fakeWindow: Window = {} as Window
vi.stubGlobal('window', fakeWindow)
let client: typeof import('./client')
beforeAll(async () => {
  client = await import('./client')
})

const settings: Settings = { theme: 'dark', lyricsFromLrclib: true, menuBarItem: true, miniPlayer: false, mediaKeys: true }

describe('media requests', () => {
  it('posts settings, lyrics and app requests with their params', async () => {
    const results: LrclibResult[] = [{ durationSec: 200, syncedLyrics: '[00:01.00] Placeholder line 1' }]
    const postMessage = vi.fn().mockImplementation(({ method }) =>
      Promise.resolve(method.startsWith('settings.') ? settings : method === 'lyrics.lrclib' ? results : null),
    )
    fakeWindow.webkit = { messageHandlers: { melo: { postMessage } } }
    await expect(client.request('settings.get', {})).resolves.toEqual(settings)
    await expect(client.request('settings.set', { theme: 'dark' })).resolves.toEqual(settings)
    await expect(client.request('lyrics.lrclib', { title: 'T', artist: 'A', durationSec: 200 })).resolves.toEqual(results)
    await expect(client.request('app.showWindow', {})).resolves.toBeNull()
    await expect(client.request('app.quit', {})).resolves.toBeNull()
    expect(postMessage.mock.calls.map(([m]) => m)).toEqual([
      { method: 'settings.get', params: {} },
      { method: 'settings.set', params: { theme: 'dark' } },
      { method: 'lyrics.lrclib', params: { title: 'T', artist: 'A', durationSec: 200 } },
      { method: 'app.showWindow', params: {} },
      { method: 'app.quit', params: {} },
    ])
  })

  it('delivers settings.changed', () => {
    const listener = vi.fn()
    const off = client.on('settings.changed', listener)
    const event: Event = { name: 'settings.changed', payload: settings }
    expect(window.melo!.emit(event)).toBe(1)
    expect(listener).toHaveBeenCalledWith(settings)
    off()
  })
})

describe('library messages', () => {
  it('posts library.broadcast and delivers library.changed', async () => {
    const postMessage = vi.fn().mockResolvedValue(null)
    fakeWindow.webkit = { messageHandlers: { melo: { postMessage } } }
    await expect(client.request('library.broadcast', { key: 'song:v1', value: 'LIKE' })).resolves.toBeNull()
    expect(postMessage).toHaveBeenCalledWith({ method: 'library.broadcast', params: { key: 'song:v1', value: 'LIKE' } })
    const listener = vi.fn()
    const off = client.on('library.changed', listener)
    expect(window.melo!.emit({ name: 'library.changed', payload: { key: 'list:PLa', value: false } })).toBe(1)
    expect(listener).toHaveBeenCalledWith({ key: 'list:PLa', value: false })
    off()
  })
})

describe('content security policy', () => {
  it('allows only YouTube image hosts remotely, and no inline script in the build', () => {
    const csp = contentSecurityPolicy(false)
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("script-src 'self';")
    expect(csp).toContain("connect-src 'self';")
    expect(csp).not.toContain('unsafe')
    const remote = csp.match(/https?:\/\/[^\s;]+/g)
    expect(remote).toEqual([
      'https://lh3.googleusercontent.com',
      'https://yt3.googleusercontent.com',
      'https://yt3.ggpht.com',
      'https://i.ytimg.com',
      'https://music.youtube.com/image/',
      'https://www.gstatic.com/music/',
      'https://www.gstatic.com/youtube/media/',
    ])
  })

  it('lets the dev server run React Refresh and HMR', () => {
    const csp = contentSecurityPolicy(true)
    expect(csp).toContain("script-src 'self' 'unsafe-inline'")
    expect(csp).toContain('connect-src \'self\' ws://127.0.0.1:5173')
  })
})
