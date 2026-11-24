import { useEffect, useRef, useState } from 'react'
import type { Song } from '../api/models'
import { request } from '../bridge/client'
import { EmptyState } from '../components/States'
import { reducedMotion } from '../motion'
import { createLyricsLoader, currentLine, nextLineTime, type LyricLine, type LyricsTrack } from '../lyrics'
import { usePlayer } from '../player/state'
import { useSettings } from '../settings'
import { useStore } from '../store'

const loader = createLyricsLoader()

/**
 * The line being sung. Player state arrives at most four times a second, so between updates a timer fires at the
 * next line's start instead of waiting for the next update.
 */
function useCurrentLine(lines: LyricLine[]): number {
  const { currentTime, status } = usePlayer()
  // The line start a timer reached since the last update, which is stale once the next update arrives.
  const [reached, setReached] = useState<{ from: number; time: number }>()
  useEffect(() => {
    const upcoming = status === 'playing' ? nextLineTime(lines, currentTime) : undefined
    if (upcoming === undefined) return
    const timer = setTimeout(() => setReached({ from: currentTime, time: upcoming }), (upcoming - currentTime) * 1000)
    return () => clearTimeout(timer)
  }, [lines, currentTime, status])
  return currentLine(lines, reached?.from === currentTime ? reached.time : currentTime)
}

export function LyricsPanel({ song }: { song?: Song }) {
  const { lyricsFromLrclib } = useSettings()
  const track: LyricsTrack | undefined = song && {
    videoId: song.videoId,
    title: song.title,
    artist: song.artists.map((a) => a.name).join(', '),
    durationSec: song.durationSec,
  }
  const key = track && JSON.stringify(track)
  useEffect(() => {
    loader.load(key ? (JSON.parse(key) as LyricsTrack) : undefined, lyricsFromLrclib)
  }, [key, lyricsFromLrclib])

  const state = useStore(loader.state)
  // Only ever the current song's lyrics, however late an earlier answer arrives.
  const lyrics = state.status === 'done' && state.videoId === song?.videoId ? state.lyrics : undefined
  const lines = lyrics?.lines ?? NONE
  const at = useCurrentLine(lyrics?.synced ? lines : NONE)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (at >= 0) list.current?.children[at]?.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' })
  }, [at])

  if (!song) return <EmptyState icon="lyrics" title="Nothing playing" />
  if (state.videoId !== song.videoId || state.status === 'loading') return <div className="now-panel" aria-busy="true" />
  if (!lyrics) return <EmptyState icon="lyrics" title="No lyrics for this song" />
  const credit = [lyrics.synced ? 'Synced' : undefined, lyrics.source, lyrics.credit].filter(Boolean).join(' · ')
  return (
    <>
      <div ref={list} className={lyrics.synced ? 'now-panel lyrics synced' : 'now-panel lyrics'}>
        {lines.map((line, i) =>
          line.text ? (
            <button
              key={i}
              type="button"
              className={i === at ? 'ln at' : i < at ? 'ln past' : 'ln'}
              disabled={line.time === undefined}
              onClick={() => line.time !== undefined && void request('player.seek', { seconds: line.time })}
            >
              {line.text}
            </button>
          ) : (
            <div key={i} className="ln-gap" />
          ),
        )}
      </div>
      <div className="lyrics-foot muted">
        <span className="lyrics-credit">{credit}</span>
        <span>{lyrics.synced ? 'Click a line to jump to it' : 'Not synced'}</span>
      </div>
    </>
  )
}

const NONE: LyricLine[] = []
