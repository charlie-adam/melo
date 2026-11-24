import { describe, expect, it, vi } from 'vitest'
import { fixture } from './api/fixture'
import { parseLyrics } from './api/parse/watch'
import { best, chooseLrclib, createLyricsLoader, currentLine, fetchLyrics, findTimedLyrics, lyricLines, nextLineTime, parseLrc, type Lyrics } from './lyrics'

// The real bridge client needs a browser window; these tests pass their own fetchers.
vi.mock('./bridge/client', () => ({ request: vi.fn(), on: vi.fn() }))

describe('lyricLines', () => {
  it('splits parsed lyrics into lines with blank stanza breaks', () => {
    const lines = lyricLines(parseLyrics(fixture('lyrics'))!.text)
    expect(lines[0]).toEqual({ text: 'Placeholder line 1' })
    expect(lines[2]).toEqual({ text: '' })
    expect(lines.every((l) => l.time === undefined)).toBe(true)
  })
})

describe('currentLine', () => {
  const lines = [{ text: 'a', time: 10 }, { text: '' }, { text: 'b', time: 15 }, { text: 'c', time: 20.5 }]

  it('selects the last line that has started', () => {
    expect(currentLine(lines, 9.9)).toBe(-1)
    expect(currentLine(lines, 10)).toBe(0)
    expect(currentLine(lines, 14.99)).toBe(0)
    expect(currentLine(lines, 15)).toBe(2)
    expect(currentLine(lines, 300)).toBe(3)
  })

  it('selects nothing for unsynced lyrics', () => {
    expect(currentLine([{ text: 'a' }, { text: 'b' }], 60)).toBe(-1)
  })
})

describe('parseLrc', () => {
  it('reads stamps, repeated stamps, blank lines and the offset tag, sorted by time', () => {
    const lrc = ['[ar:Placeholder]', '[offset:+500]', '[00:12.50]Placeholder line 2', '[00:01.00][01:02.25] Placeholder chorus', '[00:20.00]', 'untimed text'].join('\n')
    expect(parseLrc(lrc)).toEqual([
      { text: 'Placeholder chorus', time: 0.5 },
      { text: 'Placeholder line 2', time: 12 },
      { text: '', time: 19.5 },
      { text: 'Placeholder chorus', time: 61.75 },
    ])
  })

  it('returns undefined when nothing is timed', () => {
    expect(parseLrc('Placeholder line 1\nPlaceholder line 2')).toBeUndefined()
    expect(parseLrc('')).toBeUndefined()
  })
})

describe('chooseLrclib', () => {
  const synced = '[00:01.00] Placeholder line 1'
  it('keeps results within 2 s and prefers synced, then the closest length', () => {
    const results = [
      { durationSec: 200.5, plainLyrics: 'plain close' },
      { durationSec: 201.9, plainLyrics: 'p', syncedLyrics: synced },
      { durationSec: 199, syncedLyrics: synced },
      { durationSec: 230, syncedLyrics: synced },
    ]
    expect(chooseLrclib(results, 200)).toEqual(results[2])
    expect(chooseLrclib([results[0], results[3]], 200)).toEqual(results[0])
    expect(chooseLrclib([results[3]], 200)).toBeUndefined()
  })

  it('treats unparseable synced text as plain', () => {
    const bad = { durationSec: 200.5, syncedLyrics: 'no stamps here', plainLyrics: 'p' }
    const plain = { durationSec: 200.2, plainLyrics: 'q' }
    expect(chooseLrclib([plain, bad], 200)).toEqual(plain)
  })
})

describe('findTimedLyrics', () => {
  it('finds timedLyricsModel anywhere in a response', () => {
    const raw = { a: [{ b: { timedLyricsModel: { lyricsData: [{ lyricLine: 'Placeholder 2', startTimeMs: '4000', durationMs: '1000' }, { lyricLine: 'Placeholder 1', startTimeMs: '1500' }] } } }] }
    expect(findTimedLyrics(raw)).toEqual([
      { text: 'Placeholder 1', time: 1.5 },
      { text: 'Placeholder 2', time: 4 },
    ])
    expect(findTimedLyrics(fixture('next'))).toBeUndefined()
  })
})

describe('best and fetchLyrics', () => {
  const plain = (source: 'YouTube Music' | 'LRCLIB') => ({ lines: [{ text: 'x' }], synced: false, source })
  const synced = (source: 'YouTube Music' | 'LRCLIB') => ({ lines: [{ text: 'x', time: 1 }], synced: true, source })

  it('prefers synced, then YouTube Music on a tie', () => {
    expect(best([plain('YouTube Music'), synced('LRCLIB')])?.source).toBe('LRCLIB')
    expect(best([synced('YouTube Music'), synced('LRCLIB')])?.source).toBe('YouTube Music')
    expect(best([plain('YouTube Music'), plain('LRCLIB')])?.source).toBe('YouTube Music')
    expect(best([undefined, plain('LRCLIB')])?.source).toBe('LRCLIB')
    expect(best([undefined, undefined])).toBeUndefined()
  })

  const track = { videoId: 'abc', title: 'T', artist: 'A', durationSec: 200 }
  const ytCall = async (req: { endpoint: string; body: Record<string, unknown> }) => (req.endpoint === 'next' ? fixture('next') : fixture('lyrics'))

  it('uses LRCLIB synced lines over YouTube Music plain text', async () => {
    const lrclib = vi.fn().mockResolvedValue([{ durationSec: 200, syncedLyrics: '[00:01.00] Placeholder line 1' }])
    const lyrics = await fetchLyrics(track, true, { call: ytCall, lrclib })
    expect(lyrics).toEqual({ lines: [{ text: 'Placeholder line 1', time: 1 }], synced: true, source: 'LRCLIB' })
    expect(lrclib).toHaveBeenCalledWith({ title: 'T', artist: 'A', durationSec: 200 })
  })

  it('skips LRCLIB when the setting is off, and survives a failed source', async () => {
    const lrclib = vi.fn()
    const lyrics = await fetchLyrics(track, false, { call: ytCall, lrclib })
    expect(lrclib).not.toHaveBeenCalled()
    expect(lyrics?.source).toBe('YouTube Music')
    expect(lyrics?.synced).toBe(false)
    const failing = await fetchLyrics(track, true, { call: () => Promise.reject(new Error('offline')), lrclib: vi.fn().mockResolvedValue([{ durationSec: 201, plainLyrics: 'Placeholder' }]) })
    expect(failing).toEqual({ lines: [{ text: 'Placeholder' }], synced: false, source: 'LRCLIB' })
  })
})

describe('createLyricsLoader', () => {
  function deferred() {
    let resolve!: (value: Lyrics | undefined) => void
    const promise = new Promise<Lyrics | undefined>((r) => (resolve = r))
    return { promise, resolve }
  }
  const track = (videoId: string) => ({ videoId, title: videoId, artist: 'A', durationSec: 100 })
  const lyrics = (text: string): Lyrics => ({ lines: [{ text }], synced: false, source: 'LRCLIB' })

  it('never shows an earlier track after skipping', async () => {
    const pending = new Map<string, ReturnType<typeof deferred>>()
    const loader = createLyricsLoader((t) => {
      const d = deferred()
      pending.set(t.videoId, d)
      return d.promise
    })
    loader.load(track('a'), true)
    loader.load(track('b'), true)
    expect(loader.state.get()).toEqual({ videoId: 'b', status: 'loading' })
    pending.get('a')!.resolve(lyrics('A'))
    await Promise.resolve()
    expect(loader.state.get()).toEqual({ videoId: 'b', status: 'loading' })
    pending.get('b')!.resolve(lyrics('B'))
    await Promise.resolve()
    expect(loader.state.get()).toEqual({ videoId: 'b', status: 'done', lyrics: lyrics('B') })
    // Going back to a is answered from the cache, without fetching again.
    loader.load(track('a'), true)
    expect(loader.state.get()).toEqual({ videoId: 'a', status: 'done', lyrics: lyrics('A') })
    expect(pending.size).toBe(2)
  })

  it('refetches when the LRCLIB setting changes, and goes idle with no track', () => {
    const fetcher = vi.fn().mockReturnValue(new Promise(() => {}))
    const loader = createLyricsLoader(fetcher)
    loader.load(track('a'), true)
    loader.load(track('a'), true)
    loader.load(track('a'), false)
    expect(fetcher).toHaveBeenCalledTimes(2)
    loader.load(undefined, false)
    expect(loader.state.get()).toEqual({ status: 'idle' })
  })
})

describe('nextLineTime', () => {
  it('finds the next timed line after now', () => {
    const lines = [{ text: 'a', time: 1 }, { text: '' }, { text: 'b', time: 5 }]
    expect(nextLineTime(lines, 0)).toBe(1)
    expect(nextLineTime(lines, 1)).toBe(5)
    expect(nextLineTime(lines, 5)).toBeUndefined()
  })
})
