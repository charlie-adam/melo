import { describe, expect, it } from 'vitest'
import source from '../../../Sources/Melo/Resources/player-core.js?raw'

// player-core.js is a plain script that the shell injects into the player page, so the test runs it the same way:
// as source text, returning the object it declares.
interface Snapshot {
  status: string
  currentTime: number
  [key: string]: unknown
}
interface Core {
  generation(href: string): number
  settleWait(advanceUntil: number, now: number): number
  playPath(input: { expected: boolean; settling: boolean; onTrack: boolean; fresh: boolean }): string
  needsEndCleanup(input: { ended: boolean; cleaned: boolean; settling: boolean; pageVideoId: string | null; expected: string | null }): boolean
  mayPlay(input: { hold: boolean; expected: string | null; isAd: boolean; pageVideoId: string | null }): boolean
  status(input: { expected: string | null; fresh: boolean; ended: boolean; error: string | null; paused: boolean; readyState: number }): string
  shouldSend(previous: Snapshot | null, next: Snapshot, msSinceLast: number, intervalMs: number): boolean
  artwork(list: { src: string; sizes?: string }[] | undefined): string | null
  byline(text: string | undefined): { artist: string | null; album: string | null }
}
const core = new Function(`${source}\nreturn PlayerCore`)() as Core

describe('generation', () => {
  it('reads the query, then the fragment', () => {
    expect(core.generation('https://music.youtube.com/watch?v=x&meloGeneration=4#meloGeneration=4')).toBe(4)
    expect(core.generation('https://music.youtube.com/watch?v=x#meloGeneration=7')).toBe(7)
  })

  it('is -1 when missing or not a whole number', () => {
    expect(core.generation('https://music.youtube.com/watch?v=x')).toBe(-1)
    expect(core.generation('https://music.youtube.com/?meloGeneration=1.5')).toBe(-1)
    expect(core.generation('https://music.youtube.com/?meloGeneration=')).toBe(-1)
  })
})

describe('mayPlay', () => {
  const base = { hold: false, expected: 'abc', isAd: false, pageVideoId: 'abc' }

  it('plays only the requested track or its ad', () => {
    expect(core.mayPlay(base)).toBe(true)
    expect(core.mayPlay({ ...base, isAd: true, pageVideoId: 'ad1' })).toBe(true)
    expect(core.mayPlay({ ...base, pageVideoId: 'radio' })).toBe(false)
  })

  it('never plays while held or on the home preload', () => {
    expect(core.mayPlay({ ...base, hold: true })).toBe(false)
    expect(core.mayPlay({ ...base, expected: null, pageVideoId: null })).toBe(false)
  })
})

describe('settleWait', () => {
  // Regression: a router load sent within YouTube Music's own post-end load dropped the next track to loading.
  it('holds the next load until the page has settled after an end', () => {
    expect(core.settleWait(11_500, 10_000)).toBe(1500)
    expect(core.settleWait(10_000, 10_000)).toBe(0)
    expect(core.settleWait(0, 10_000)).toBe(0)
  })
})

describe('playPath', () => {
  const bound = { expected: true, settling: false, onTrack: true, fresh: true }

  // Regression: Previous after the end of the queue played while the end-of-queue route was still loading the track.
  it('waits for the media to bind when the page shows the track but is still loading it', () => {
    expect(core.playPath({ ...bound, fresh: false })).toBe('bind')
  })

  it('settles first after an end or on another track, and plays a bound track at once', () => {
    expect(core.playPath({ ...bound, settling: true })).toBe('settle')
    expect(core.playPath({ ...bound, onTrack: false })).toBe('settle')
    expect(core.playPath(bound)).toBe('now')
    expect(core.playPath({ ...bound, expected: false, fresh: false })).toBe('now')
  })
})

describe('needsEndCleanup', () => {
  const swapped = { ended: true, cleaned: false, settling: false, pageVideoId: 'radio', expected: 'mine' }

  it('brings the page back once YouTube Music has loaded its own track over an ended one', () => {
    expect(core.needsEndCleanup(swapped)).toBe(true)
  })

  it('waits for the page to settle, runs once, and leaves a page on Melo\'s track alone', () => {
    expect(core.needsEndCleanup({ ...swapped, settling: true })).toBe(false)
    expect(core.needsEndCleanup({ ...swapped, cleaned: true })).toBe(false)
    expect(core.needsEndCleanup({ ...swapped, pageVideoId: 'mine' })).toBe(false)
    expect(core.needsEndCleanup({ ...swapped, ended: false })).toBe(false)
  })
})

describe('status', () => {
  const base = { expected: 'abc', fresh: true, ended: false, error: null, paused: false, readyState: 4 }

  it('maps the page to one status', () => {
    expect(core.status(base)).toBe('playing')
    expect(core.status({ ...base, paused: true })).toBe('paused')
    expect(core.status({ ...base, readyState: 2 })).toBe('loading')
    expect(core.status({ ...base, fresh: false })).toBe('loading')
    expect(core.status({ ...base, ended: true })).toBe('ended')
    expect(core.status({ ...base, expected: null })).toBe('idle')
    expect(core.status({ ...base, error: 'Player error 150' })).toBe('error')
  })
})

describe('shouldSend', () => {
  const state = { status: 'playing', videoId: 'abc', currentTime: 10 }

  it('sends the first state and any change besides the clock at once', () => {
    expect(core.shouldSend(null, state, 0, 250)).toBe(true)
    expect(core.shouldSend(state, { ...state, status: 'paused' }, 0, 250)).toBe(true)
    expect(core.shouldSend(state, { ...state, videoId: 'def' }, 0, 250)).toBe(true)
  })

  it('throttles clock-only changes', () => {
    expect(core.shouldSend(state, { ...state, currentTime: 10.1 }, 100, 250)).toBe(false)
    expect(core.shouldSend(state, { ...state, currentTime: 10.3 }, 250, 250)).toBe(true)
    expect(core.shouldSend(state, state, 1000, 250)).toBe(false)
  })
})

describe('artwork', () => {
  it('picks the largest image', () => {
    const list = [
      { src: 'small', sizes: '60x60' },
      { src: 'large', sizes: '544x544' },
      { src: 'medium', sizes: '226x226' },
    ]
    expect(core.artwork(list)).toBe('large')
    expect(core.artwork([])).toBeNull()
    expect(core.artwork(undefined)).toBeNull()
  })
})

describe('byline', () => {
  it('reads artist and album from a song byline', () => {
    expect(core.byline('Pablo Casals • Bach: The 6 Cello Suites • 2019')).toEqual({
      artist: 'Pablo Casals',
      album: 'Bach: The 6 Cello Suites',
    })
  })

  it('has no album for a video byline', () => {
    expect(core.byline('Artist • 1.2M views • 30K likes')).toEqual({ artist: 'Artist', album: null })
    expect(core.byline('')).toEqual({ artist: null, album: null })
  })
})
