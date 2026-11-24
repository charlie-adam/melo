import { useMemo, useState } from 'react'
import type { HomeChip, Shelf as ShelfModel, Song } from '../api/models'
import { parseHome, parseHomeChips, parseHomeContinuation } from '../api/parse/home'
import { browse, browseContinuation } from '../api/requests'
import { playFrom } from '../components/items'
import { Sentinel } from '../components/Sentinel'
import { Shelf } from '../components/Shelf'
import { EmptyState, LoadError, PageSkeleton } from '../components/States'
import { Icon } from '../icons'
import { useApi, usePaged } from '../useApi'

const parse = (raw: unknown) => ({ ...parseHome(raw), chips: parseHomeChips(raw) })
const parseMore = (raw: unknown) => {
  const page = parseHomeContinuation(raw)
  return { items: page.shelves, continuation: page.continuation }
}

export function Home() {
  const [mood, setMood] = useState<string>()
  const [chips, setChips] = useState<HomeChip[]>([])
  const { data, error } = useApi(browse('FEmusic_home', mood), parse)
  if (data?.chips.length && data.chips !== chips) setChips(data.chips)
  const first = useMemo(() => data && { items: data.shelves, continuation: data.continuation }, [data])
  const { items: shelves, token, more } = usePaged<ShelfModel>(first, browseContinuation, parseMore)

  return (
    <div className="screen home">
      {chips.length > 0 && (
        <div className="chips" role="group" aria-label="Moods">
          <button type="button" className="chip" aria-pressed={mood === undefined} onClick={() => setMood(undefined)}>
            All
          </button>
          {chips.map((chip) => (
            <button key={chip.params} type="button" className="chip" aria-pressed={mood === chip.params} onClick={() => setMood(chip.params)}>
              {chip.label}
            </button>
          ))}
        </div>
      )}
      {error ? (
        <LoadError />
      ) : !data ? (
        <PageSkeleton />
      ) : shelves.length === 0 ? (
        <EmptyState icon="home" title="Nothing to show yet" text="Play some music and recommendations show up here." />
      ) : (
        shelves.map((shelf, i) => <Shelf key={`${shelf.title}${i}`} shelf={shelf} action={shelf.items.every((s) => s.kind === 'song') && <PlayAll songs={shelf.items as Song[]} label={shelf.title} />} />)
      )}
      {token && <Sentinel onVisible={more} />}
    </div>
  )
}

function PlayAll({ songs, label }: { songs: Song[]; label: string }) {
  return (
    <button type="button" className="btn" onClick={() => playFrom(songs, 0, { label })}>
      <Icon name="play" size={14} />
      Play all
    </button>
  )
}
