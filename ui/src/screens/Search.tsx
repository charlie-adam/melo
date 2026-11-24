import { useEffect, useMemo, useState } from 'react'
import type { Item, SearchFilter, SearchResults, Song, Suggestions } from '../api/models'
import { parseSearch, parseSearchContinuation } from '../api/parse/search'
import { search, searchContinuation } from '../api/requests'
import { Art } from '../components/Art'
import { dot, formatTime, itemSubtitle, itemTitle, openItem, playFrom, shuffled, SongRow } from '../components/items'
import { Sentinel } from '../components/Sentinel'
import { CardGrid } from '../components/Shelf'
import { EmptyState, LoadError, PageSkeleton } from '../components/States'
import { Icon } from '../icons'
import { navigate } from '../nav/history'
import { startRadio } from '../queue'
import { toast } from '../toasts'
import { useApi, usePaged } from '../useApi'
import './Search.css'
import { createSuggester } from './suggest'

export function SearchScreen({ query, params }: { query: string; params?: string }) {
  return (
    <div className="screen search">
      <SearchField query={query} />
      {query ? <Results key={`${query}\n${params}`} query={query} params={params} /> : <EmptyState icon="search" title="Search YouTube Music" text="Find songs, albums, artists and playlists." />}
    </div>
  )
}

function SearchField({ query }: { query: string }) {
  const [text, setText] = useState(query)
  const [open, setOpen] = useState(false)
  const [hot, setHot] = useState(-1)
  const [found, setFound] = useState<Suggestions & { input: string }>()
  const [suggester] = useState(() => createSuggester((input, result) => setFound({ input, ...result })))
  useEffect(() => () => suggester.cancel(), [suggester])

  const shown = open && found && text.trim() ? found : undefined
  const queries = shown?.queries.slice(0, 5) ?? []
  const items = shown?.items.slice(0, 4) ?? []
  const count = queries.length + items.length

  const submit = (value: string) => {
    const q = value.trim()
    if (!q) return
    setOpen(false)
    suggester.cancel()
    navigate({ name: 'search', query: q })
  }
  const choose = (index: number) => {
    if (index < queries.length) return submit(queries[index])
    setOpen(false)
    openItem(items[index - queries.length])
  }

  return (
    <div className="search-box">
      <label className="search-field">
        <Icon name="search" size={16} />
        <span className="visually-hidden">Search songs, albums, artists</span>
        <input
          id="search-input"
          type="search"
          value={text}
          placeholder="Search songs, albums, artists"
          autoComplete="off"
          spellCheck={false}
          autoFocus={!query}
          role="combobox"
          aria-expanded={count > 0}
          aria-controls="search-suggestions"
          onChange={(e) => {
            const value = e.target.value
            setText(value)
            setOpen(true)
            setHot(-1)
            suggester.type(value)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              if (count === 0) return
              e.preventDefault()
              setHot((h) => (e.key === 'ArrowDown' ? (h + 1) % count : (h - 1 + count) % count))
            } else if (e.key === 'Enter') {
              if (hot >= 0 && hot < count) choose(hot)
              else submit(text)
            } else if (e.key === 'Escape') {
              setOpen(false)
            }
          }}
        />
        {text && (
          <button
            type="button"
            className="ib clear"
            aria-label="Clear search"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setText('')
              suggester.type('')
              setFound(undefined)
              document.getElementById('search-input')?.focus()
            }}
          >
            <Icon name="close" size={14} />
          </button>
        )}
      </label>
      {count > 0 && (
        <div id="search-suggestions" className="suggestions" role="listbox" onMouseDown={(e) => e.preventDefault()}>
          {queries.map((q, i) => (
            <div key={q} role="option" aria-selected={hot === i} className={hot === i ? 'sg hot' : 'sg'} onMouseEnter={() => setHot(i)} onClick={() => choose(i)}>
              <Icon name="search" size={14} />
              <span className="sg-text">
                {q.startsWith(shown!.input.toLowerCase()) ? (
                  <>
                    {q.slice(0, shown!.input.length)}
                    <b>{q.slice(shown!.input.length)}</b>
                  </>
                ) : (
                  q
                )}
              </span>
            </div>
          ))}
          {queries.length > 0 && items.length > 0 && <div className="sep" />}
          {items.map((item, j) => {
            const i = queries.length + j
            return (
              <div key={i} role="option" aria-selected={hot === i} className={hot === i ? 'sg item hot' : 'sg item'} onMouseEnter={() => setHot(i)} onClick={() => choose(i)}>
                <Art thumbnails={item.thumbnails} size={30} round={item.kind === 'artist' || item.kind === 'profile'} />
                <span className="sg-item-text">
                  <span className="t1">{itemTitle(item)}</span>
                  <span className="t2">{itemSubtitle(item, true)}</span>
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const GROUPS: { title: string; filter: string; test: (i: Item) => boolean }[] = [
  { title: 'Albums', filter: 'Albums', test: (i) => i.kind === 'album' },
  { title: 'Artists', filter: 'Artists', test: (i) => i.kind === 'artist' },
  { title: 'Videos', filter: 'Videos', test: (i) => i.kind === 'song' && i.isVideo },
  { title: 'Playlists', filter: 'Community playlists', test: (i) => i.kind === 'playlist' },
  { title: 'Profiles', filter: 'Profiles', test: (i) => i.kind === 'profile' },
]

function Results({ query, params }: { query: string; params?: string }) {
  const { data, error } = useApi(search(query, params), parseSearch)
  if (error) return <LoadError />
  if (!data) return <PageSkeleton />
  const filter = (label: string) => data.filters.find((f) => f.label === label)
  return (
    <>
      <Filters query={query} params={params} filters={data.filters} />
      {params ? <Filtered first={data} /> : <All results={data} query={query} filter={filter} />}
    </>
  )
}

function Filters({ query, params, filters }: { query: string; params?: string; filters: SearchFilter[] }) {
  if (filters.length === 0) return null
  return (
    <div className="chips" role="group" aria-label="Filters">
      <button type="button" className="chip" aria-pressed={!params} onClick={() => navigate({ name: 'search', query })}>
        All
      </button>
      {filters.map((f) => (
        <button key={f.params} type="button" className="chip" aria-pressed={params === f.params} onClick={() => navigate({ name: 'search', query, params: f.params })}>
          {f.label}
        </button>
      ))}
    </div>
  )
}

const songSub = (song: Song) => dot([song.isVideo ? 'Video' : 'Song', song.artists.map((a) => a.name).join(', '), song.album?.name])

function All({ results, query, filter }: { results: SearchResults; query: string; filter: (label: string) => SearchFilter | undefined }) {
  const all = results.sections.flatMap((s) => s.items)
  const songs = all.filter((i): i is Song => i.kind === 'song' && !i.isVideo)
  const listed = songs.length > 0 ? songs : (results.topResult?.contents.filter((i): i is Song => i.kind === 'song') ?? [])
  const songsFilter = filter('Songs')
  if (!results.topResult && all.length === 0) return <EmptyState icon="search" title="No results" text={`Nothing matched "${query}". Check the spelling or try fewer words.`} />

  return (
    <>
      {(results.topResult || listed.length > 0) && (
        <div className="search-top">
          {results.topResult && (
            <section className="section">
              <div className="section-head">
                <h2 className="h2">Top result</h2>
              </div>
              <TopResult item={results.topResult.item} contents={results.topResult.contents} />
            </section>
          )}
          {listed.length > 0 && (
            <section className="section">
              <div className="section-head">
                <h2 className="h2">Songs</h2>
                {songsFilter && (
                  <button type="button" className="chip" onClick={() => navigate({ name: 'search', query, params: songsFilter.params })}>
                    Show all
                  </button>
                )}
              </div>
              <div>
                {listed.slice(0, 4).map((song, i) => (
                  <SongRow key={song.videoId} song={song} sub={songSub(song)} onPlay={() => playFrom(listed, i, { label: query })} extra={<span className="row-aside" style={{ width: 40 }}>{formatTime(song.durationSec)}</span>} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
      {GROUPS.map((group) => {
        const items = all.filter(group.test)
        if (items.length === 0) return null
        const f = filter(group.filter)
        return (
          <section key={group.title} className="section">
            <div className="section-head">
              <h2 className="h2">{group.title}</h2>
              {f && (
                <button type="button" className="chip" onClick={() => navigate({ name: 'search', query, params: f.params })}>
                  Show all
                </button>
              )}
            </div>
            <CardGrid items={items.slice(0, 6)} />
          </section>
        )
      })}
    </>
  )
}

function TopResult({ item, contents }: { item: Item; contents: Item[] }) {
  const round = item.kind === 'artist' || item.kind === 'profile'
  const songs = contents.filter((i): i is Song => i.kind === 'song')
  const seed = item.kind === 'song' ? item : songs[0]
  const shuffle = () => playFrom(shuffled(songs), 0, { label: itemTitle(item) })
  return (
    <div className="top-result" role="button" tabIndex={0} onClick={() => openItem(item)} onKeyDown={(e) => e.key === 'Enter' && openItem(item)}>
      <Art thumbnails={item.thumbnails} size={96} round={round} />
      <div className="top-text">
        <div className="top-title">{itemTitle(item)}</div>
        <div className="muted top-sub">{itemSubtitle(item, true)}</div>
      </div>
      <div className="top-actions">
        {item.kind === 'song' ? (
          <button type="button" className="btn primary" onClick={(e) => (e.stopPropagation(), openItem(item))}>
            <Icon name="play" size={14} />
            Play
          </button>
        ) : (
          songs.length > 0 && (
            <button type="button" className="btn primary" onClick={(e) => (e.stopPropagation(), shuffle())}>
              <Icon name="shuffle" size={15} />
              Shuffle
            </button>
          )
        )}
        {seed && (
          <button type="button" className="btn on-muted" onClick={(e) => (e.stopPropagation(), void startRadio(seed.videoId).catch(() => toast("Couldn't start radio.")))}>
            <Icon name="radio" size={15} />
            Radio
          </button>
        )}
      </div>
    </div>
  )
}

function Filtered({ first }: { first: SearchResults }) {
  const page = useMemo(() => ({ items: first.sections.flatMap((s) => s.items), continuation: first.continuation }), [first])
  const { items, token, more } = usePaged<Item>(page, searchContinuation, parseSearchContinuation)
  if (items.length === 0) return <EmptyState icon="search" title="No results" text="Try another filter or fewer words." />
  const songs = items.every((i) => i.kind === 'song') ? (items as Song[]) : undefined
  return (
    <>
      {songs ? (
        <div className="search-list">
          {songs.map((song, i) => (
            <SongRow key={`${song.videoId}${i}`} song={song} sub={songSub(song)} onPlay={() => playFrom(songs, i)} extra={<span className="row-aside" style={{ width: 40 }}>{formatTime(song.durationSec)}</span>} />
          ))}
        </div>
      ) : (
        <CardGrid items={items} />
      )}
      {token && <Sentinel onVisible={more} />}
    </>
  )
}
