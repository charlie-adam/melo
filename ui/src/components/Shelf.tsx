import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Item, Shelf as ShelfModel, Song } from '../api/models'
import { Icon } from '../icons'
import { Card, playFrom, SongRow } from './items'
import './Shelf.css'

const isSong = (i: Item): i is Song => i.kind === 'song'

/**
 * A titled row that scrolls sideways a page at a time: song rows in three columns of up to four, or cards six across.
 */
/** YouTube Music sends some straplines in capitals; Melo shows them in sentence case. */
const sentenceCase = (text: string) => (text === text.toUpperCase() ? text.charAt(0) + text.slice(1).toLowerCase() : text)

export function Shelf({ shelf, action }: { shelf: ShelfModel; action?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ start: true, end: true })
  const songs = shelf.items.every(isSong) ? (shelf.items as Song[]) : undefined

  useEffect(() => {
    const el = ref.current!
    const update = () => setEdges({ start: el.scrollLeft <= 1, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    el.addEventListener('scroll', update, { passive: true })
    return () => {
      observer.disconnect()
      el.removeEventListener('scroll', update)
    }
  }, [])

  const page = (direction: number) => {
    const el = ref.current!
    el.scrollBy({ left: direction * (el.clientWidth + 16), behavior: 'smooth' })
  }
  const source = { label: shelf.title }
  const scrolls = !(edges.start && edges.end)

  return (
    <section className="section">
      <div className="section-head">
        <div className="shelf-title">
          {shelf.strapline && <span className="shelf-strapline">{sentenceCase(shelf.strapline)}</span>}
          <h2 className="h2">{shelf.title}</h2>
        </div>
        <div className="section-tools">
          {action}
          {scrolls && (
            <>
              <button type="button" className="ib" aria-label={`Scroll ${shelf.title} back`} disabled={edges.start} onClick={() => page(-1)}>
                <Icon name="back" />
              </button>
              <button type="button" className="ib" aria-label={`Scroll ${shelf.title} forward`} disabled={edges.end} onClick={() => page(1)}>
                <Icon name="forward" />
              </button>
            </>
          )}
        </div>
      </div>
      {songs ? (
        <div ref={ref} className="shelf-rows" style={{ gridTemplateRows: `repeat(${Math.min(4, songs.length)}, 56px)` }}>
          {songs.map((song, i) => (
            <SongRow key={`${song.videoId}${i}`} song={song} onPlay={() => playFrom(songs, i, source)} />
          ))}
        </div>
      ) : (
        <div ref={ref} className="shelf-cards">
          {shelf.items.map((item, i) => (
            <Card key={i} item={item} onPlay={item.kind === 'song' ? () => playFrom([item], 0, source) : undefined} />
          ))}
        </div>
      )}
    </section>
  )
}

/** Cards in a wrapping grid, six across, for lists that do not scroll sideways. */
export function CardGrid({ items }: { items: Item[] }) {
  return (
    <div className="card-grid">
      {items.map((item, i) => (
        <Card key={i} item={item} />
      ))}
    </div>
  )
}
