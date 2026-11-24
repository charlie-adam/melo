import type { Home, HomeChip } from '../models'
import { nextContinuation, shelves, text, type Raw } from './common'

/** Parses the first page of a feed such as `FEmusic_home`. Sections without items (the taste builder) are dropped. */
export function parseHome(raw: Raw): Home {
  const list = raw?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer
  return withToken(shelves(list?.contents), nextContinuation(list))
}

/** Parses a feed continuation. An exhausted feed returns no shelves and no token. */
export function parseHomeContinuation(raw: Raw): Home {
  const list = raw?.continuationContents?.sectionListContinuation
  return withToken(shelves(list?.contents), nextContinuation(list))
}

function withToken(found: Home['shelves'], continuation: string | undefined): Home {
  const result: Home = { shelves: found.filter((s) => s.items.length > 0) }
  if (continuation) result.continuation = continuation
  return result
}

/** Mood chips above the feed. Each re-requests the feed with its `params`; the unfiltered feed is the "All" chip. */
export function parseHomeChips(raw: Raw): HomeChip[] {
  const list = raw?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer
  const chips: Raw[] = list?.header?.chipCloudRenderer?.chips ?? []
  return chips
    .map((c) => c.chipCloudChipRenderer)
    .filter((c) => c?.navigationEndpoint?.browseEndpoint?.params)
    .map((c) => ({ label: text(c.text), params: c.navigationEndpoint.browseEndpoint.params }))
}
