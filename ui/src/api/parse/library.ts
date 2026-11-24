import type { Item, LibraryPage } from '../models'
import { itemContinuation, items, nextContinuation, type Raw } from './common'

/**
 * Parses a library list: `FEmusic_liked_playlists`, `FEmusic_liked_albums` or `FEmusic_library_corpus_artists`.
 * Items sit in a `gridRenderer` or `musicShelfRenderer`, sometimes inside an `itemSectionRenderer`.
 * Tiles with no browse target, such as "New playlist", are dropped by the item parser.
 */
export function parseLibrary(raw: Raw): LibraryPage {
  const sections: Raw[] = raw?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents ?? []
  const containers = sections.flatMap((s) => [s, ...((s.itemSectionRenderer?.contents ?? []) as Raw[])])
  const found: Item[] = []
  let continuation: string | undefined
  for (const c of containers) {
    const list = c.gridRenderer ? { node: c.gridRenderer, wrappers: c.gridRenderer.items } : c.musicShelfRenderer && { node: c.musicShelfRenderer, wrappers: c.musicShelfRenderer.contents }
    if (!list) continue
    found.push(...items(list.wrappers))
    continuation ??= nextContinuation(list.node) ?? itemContinuation(list.wrappers)
  }
  return page(found, continuation)
}

/** Parses a library continuation in the grid, shelf or append-action format. */
export function parseLibraryContinuation(raw: Raw): LibraryPage {
  const grid = raw?.continuationContents?.gridContinuation
  if (grid) return page(items(grid.items), nextContinuation(grid) ?? itemContinuation(grid.items))
  const shelf = raw?.continuationContents?.musicShelfContinuation
  if (shelf) return page(items(shelf.contents), nextContinuation(shelf) ?? itemContinuation(shelf.contents))
  const actions: Raw[] = raw?.onResponseReceivedActions ?? []
  const appended: Raw[] = actions.flatMap((a) => a.appendContinuationItemsAction?.continuationItems ?? [])
  return page(items(appended), itemContinuation(appended))
}

function page(found: Item[], continuation: string | undefined): LibraryPage {
  return continuation ? { items: found, continuation } : { items: found }
}
