import type { SearchFilter, SearchPage, SearchResults, SearchSection, Suggestions } from '../models'
import { cardItem, itemContinuation, items, nextContinuation, text, type Raw } from './common'

/**
 * Parses a `search` response, filtered or not, keeping the server's order.
 * Unfiltered results arrive as one untitled `itemSectionRenderer` per item; consecutive ones merge into one section.
 */
export function parseSearch(raw: Raw): SearchResults {
  const list = raw?.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer
  const result: SearchResults = { sections: [], filters: parseFilters(list?.header) }
  for (const section of (list?.contents ?? []) as Raw[]) {
    const card = section.musicCardShelfRenderer
    if (card) {
      const item = cardItem(card)
      // Songs under an artist card leave the artist out of their subtitle.
      const byline = item?.kind === 'artist' ? [{ name: item.name, browseId: item.browseId }] : []
      const contents = items(card.contents).map((i) => (i.kind === 'song' && i.artists.length === 0 ? { ...i, artists: byline } : i))
      if (item) result.topResult = { item, contents }
      continue
    }
    const shelf = section.musicShelfRenderer
    if (shelf) {
      result.sections.push({ title: text(shelf.title), items: items(shelf.contents) })
      const continuation = nextContinuation(shelf) ?? itemContinuation(shelf.contents)
      if (continuation) result.continuation = continuation
      continue
    }
    const found = items(section.itemSectionRenderer?.contents)
    if (found.length === 0) continue
    const last: SearchSection | undefined = result.sections[result.sections.length - 1]
    if (last && last.title === undefined) last.items.push(...found)
    else result.sections.push({ items: found })
  }
  result.sections = result.sections.filter((s) => s.items.length > 0)
  return result
}

function parseFilters(header: Raw): SearchFilter[] {
  const chips: Raw[] = header?.chipCloudRenderer?.chips ?? []
  return chips
    .map((c) => c.chipCloudChipRenderer)
    .filter((c) => c?.navigationEndpoint?.searchEndpoint?.params)
    .map((c) => ({ label: text(c.text), params: c.navigationEndpoint.searchEndpoint.params }))
}

/** Parses the next page of a filtered search, in either continuation format. */
export function parseSearchContinuation(raw: Raw): SearchPage {
  const shelf = raw?.continuationContents?.musicShelfContinuation
  if (shelf) return page(items(shelf.contents), nextContinuation(shelf) ?? itemContinuation(shelf.contents))
  const commands: Raw[] = raw?.onResponseReceivedCommands ?? []
  const appended: Raw[] = commands.flatMap((c) => c.appendContinuationItemsAction?.continuationItems ?? [])
  return page(items(appended), itemContinuation(appended))
}

function page(found: SearchPage['items'], continuation: string | undefined): SearchPage {
  return continuation ? { items: found, continuation } : { items: found }
}

/** Parses `music/get_search_suggestions`: query completions (including history), then suggested items. */
export function parseSuggestions(raw: Raw): Suggestions {
  const result: Suggestions = { queries: [], items: [] }
  for (const section of (raw?.contents ?? []) as Raw[]) {
    const contents: Raw[] = section.searchSuggestionsSectionRenderer?.contents ?? []
    for (const entry of contents) {
      const suggestion = entry.searchSuggestionRenderer ?? entry.historySuggestionRenderer
      if (suggestion) result.queries.push(suggestion.navigationEndpoint?.searchEndpoint?.query ?? text(suggestion.suggestion))
    }
    result.items.push(...items(contents))
  }
  return result
}
