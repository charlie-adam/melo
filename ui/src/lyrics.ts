// Lyrics: YouTube Music's own (`next`, then the `MPLYt` browse) and LRCLIB, fetched at
// the same time. The best result wins: synced beats plain beats none, and YouTube Music wins a tie. Results are keyed by
// videoId, so a slow answer for a track already skipped past is dropped. Follows Kaset (MIT),
// Services/Lyrics/SyncedLyricsService.swift and Parsers/LRCParser.swift.
import { call } from './api/call'
import type { Raw } from './api/parse/common'
import { parseLyrics, parseWatchNext } from './api/parse/watch'
import { browse, next } from './api/requests'
import { request } from './bridge/client'
import type { LrclibResult } from './bridge/protocol'
import { createStore, type Store } from './store'

/** A lyric line. `time` (seconds) is present only for synced lyrics. */
export interface LyricLine {
  text: string
  time?: number
}

/** Splits plain lyrics into lines, keeping blank lines as stanza breaks. */
export function lyricLines(text: string): LyricLine[] {
  return text.split('\n').map((line) => ({ text: line.trim() }))
}

/** The index of the line being sung at `time`: the last timed line that has started. -1 before the first, or when unsynced. */
export function currentLine(lines: LyricLine[], time: number): number {
  let found = -1
  lines.forEach((line, i) => {
    if (line.time !== undefined && line.time <= time) found = i
  })
  return found
}

/** When the line after `time` starts, for scheduling the next highlight. Undefined after the last line. */
export function nextLineTime(lines: LyricLine[], time: number): number | undefined {
  return lines.find((line) => line.time !== undefined && line.time > time)?.time
}

const STAMP = /\[(\d+):(\d+(?:\.\d+)?)\]/g

/**
 * Parses LRC: `[mm:ss.xx] text`, with any number of stamps per line and an optional `[offset:ms]` tag (positive
 * shows lines earlier). Other tags are ignored. Returns lines sorted by time, or undefined when nothing is timed.
 */
export function parseLrc(lrc: string): LyricLine[] | undefined {
  const offset = Number(/\[offset:\s*([+-]?\d+)\s*\]/i.exec(lrc)?.[1] ?? 0) / 1000
  const lines: LyricLine[] = []
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(STAMP)]
    if (stamps.length === 0) continue
    const text = raw.replace(STAMP, '').trim()
    for (const [, min, sec] of stamps) lines.push({ text, time: Math.max(0, Number(min) * 60 + Number(sec) - offset) })
  }
  if (lines.length === 0) return undefined
  return lines.sort((a, b) => a.time! - b.time!)
}

/** LRCLIB results further than this from the track's length are other recordings. */
export const DURATION_TOLERANCE = 2

/** The LRCLIB result to use: within 2 s of the track, synced before plain, then the closest in length. */
export function chooseLrclib(results: LrclibResult[], durationSec: number): LrclibResult | undefined {
  const near = results.filter((r) => Math.abs(r.durationSec - durationSec) <= DURATION_TOLERANCE && (r.syncedLyrics || r.plainLyrics))
  const score = (r: LrclibResult) => (r.syncedLyrics && parseLrc(r.syncedLyrics) ? 0 : 1)
  return near.sort((a, b) => score(a) - score(b) || Math.abs(a.durationSec - durationSec) - Math.abs(b.durationSec - durationSec))[0]
}

/** YouTube Music's timed lyrics, when a response carries `timedLyricsModel.lyricsData`; few web responses do. */
export function findTimedLyrics(raw: Raw): LyricLine[] | undefined {
  const stack: unknown[] = [raw]
  while (stack.length) {
    const node = stack.pop()
    if (!node || typeof node !== 'object') continue
    const data: Raw[] | undefined = (node as Raw).timedLyricsModel?.lyricsData
    if (Array.isArray(data) && data.length) {
      const lines = data
        .filter((l) => typeof l?.lyricLine === 'string' && !Number.isNaN(Number(l.startTimeMs)))
        .map((l) => ({ text: String(l.lyricLine).trim(), time: Number(l.startTimeMs) / 1000 }))
      if (lines.length) return lines.sort((a, b) => a.time - b.time)
    }
    stack.push(...Object.values(node))
  }
  return undefined
}

export type LyricsSource = 'YouTube Music' | 'LRCLIB'

export interface Lyrics {
  lines: LyricLine[]
  synced: boolean
  source: LyricsSource
  /** YouTube Music's credit line, such as "Source: LyricFind". */
  credit?: string
}

export interface LyricsTrack {
  videoId: string
  title: string
  artist: string
  durationSec?: number
}

/** Synced beats plain, and the first (YouTube Music) wins a tie. */
export function best(candidates: (Lyrics | undefined)[]): Lyrics | undefined {
  let found: Lyrics | undefined
  for (const c of candidates) if (c && c.lines.length && (!found || (c.synced && !found.synced))) found = c
  return found
}

export interface LyricsDeps {
  call: (req: { endpoint: string; body: Record<string, unknown> }) => Promise<unknown>
  lrclib: (params: { title: string; artist: string; durationSec: number }) => Promise<LrclibResult[]>
}

const realDeps: LyricsDeps = { call, lrclib: (params) => request('lyrics.lrclib', params) }

async function fromYouTube(videoId: string, deps: LyricsDeps): Promise<Lyrics | undefined> {
  const watch = await deps.call(next(videoId))
  const timed = findTimedLyrics(watch)
  if (timed) return { lines: timed, synced: true, source: 'YouTube Music' }
  const browseId = parseWatchNext(watch).lyricsBrowseId
  if (!browseId) return undefined
  const page = await deps.call(browse(browseId))
  const pageTimed = findTimedLyrics(page)
  if (pageTimed) return { lines: pageTimed, synced: true, source: 'YouTube Music' }
  const plain = parseLyrics(page)
  if (!plain) return undefined
  const credit = plain.source
  return { lines: lyricLines(plain.text), synced: false, source: 'YouTube Music', ...(credit ? { credit } : {}) }
}

async function fromLrclib(track: LyricsTrack, deps: LyricsDeps): Promise<Lyrics | undefined> {
  if (!track.durationSec) return undefined
  const chosen = chooseLrclib(await deps.lrclib({ title: track.title, artist: track.artist, durationSec: track.durationSec }), track.durationSec)
  const synced = chosen?.syncedLyrics ? parseLrc(chosen.syncedLyrics) : undefined
  if (synced) return { lines: synced, synced: true, source: 'LRCLIB' }
  if (chosen?.plainLyrics) return { lines: lyricLines(chosen.plainLyrics), synced: false, source: 'LRCLIB' }
  return undefined
}

/** Fetches both sources at once and keeps the best. A failed source counts as no lyrics. */
export async function fetchLyrics(track: LyricsTrack, useLrclib: boolean, deps: LyricsDeps = realDeps): Promise<Lyrics | undefined> {
  const [yt, lrc] = await Promise.allSettled([fromYouTube(track.videoId, deps), useLrclib ? fromLrclib(track, deps) : Promise.resolve(undefined)])
  return best([yt.status === 'fulfilled' ? yt.value : undefined, lrc.status === 'fulfilled' ? lrc.value : undefined])
}

export type LyricsState = { videoId?: string; status: 'idle' } | { videoId: string; status: 'loading' } | { videoId: string; status: 'done'; lyrics?: Lyrics }

/**
 * Loads lyrics for one track at a time. The state always belongs to the last track asked for: an answer for an
 * earlier one is cached but never shown.
 */
export function createLyricsLoader(fetcher: (track: LyricsTrack, useLrclib: boolean) => Promise<Lyrics | undefined> = fetchLyrics) {
  const state: Store<LyricsState> = createStore<LyricsState>({ status: 'idle' })
  const cache = new Map<string, Lyrics | undefined>()
  let wanted: string | undefined

  function load(track: LyricsTrack | undefined, useLrclib: boolean) {
    const key = track && `${track.videoId}:${useLrclib}`
    if (key === wanted) return
    wanted = key
    if (!track || !key) return state.set({ status: 'idle' })
    if (cache.has(key)) return state.set({ videoId: track.videoId, status: 'done', lyrics: cache.get(key) })
    state.set({ videoId: track.videoId, status: 'loading' })
    fetcher(track, useLrclib).then(
      (lyrics) => {
        cache.set(key, lyrics)
        if (wanted === key) state.set({ videoId: track.videoId, status: 'done', lyrics })
      },
      () => wanted === key && state.set({ videoId: track.videoId, status: 'done' }),
    )
  }

  return { state, load }
}
