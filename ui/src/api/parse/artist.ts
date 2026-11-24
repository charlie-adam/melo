import type { ArtistPage, Item, Shelf } from '../models'
import { shelves, text, thumbnails, type Raw } from './common'

/**
 * Parses an artist page (`browse` with a `UC` id). Top songs come as a `musicShelfRenderer` shelf, and albums,
 * singles, videos and related artists as carousels; each keeps its "More" link.
 */
export function parseArtistPage(raw: Raw, browseId: string): ArtistPage {
  const h = raw?.header?.musicImmersiveHeaderRenderer ?? raw?.header?.musicVisualHeaderRenderer ?? {}
  const subscribe = h.subscriptionButton?.subscribeButtonRenderer
  const list = raw?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer
  const page: ArtistPage = {
    artist: {
      kind: 'artist',
      browseId,
      name: text(h.title),
      thumbnails: thumbnails(h.thumbnail),
      subtitle: text(h.monthlyListenerCount) || text(subscribe?.longSubscriberCountText),
    },
    subscribed: subscribe?.subscribed === true,
    shelves: [],
  }
  // Albums and singles on an artist page omit the artist from their subtitle.
  const byline = [{ name: page.artist.name, browseId }]
  const withArtist = (item: Item): Item => (item.kind === 'album' && item.artists.length === 0 ? { ...item, artists: byline } : item)
  page.shelves = shelves(list?.contents)
    .filter((s) => s.items.length > 0)
    .map((s): Shelf => ({ ...s, items: s.items.map(withArtist) }))
  const description = text(h.description)
  if (description) page.description = description
  if (subscribe?.channelId) page.channelId = subscribe.channelId
  const radio = h.startRadioButton?.buttonRenderer?.navigationEndpoint
  const radioId = radio?.watchPlaylistEndpoint?.playlistId ?? radio?.watchEndpoint?.playlistId
  if (radioId) page.radioPlaylistId = radioId
  const shuffle = h.playButton?.buttonRenderer?.navigationEndpoint
  const shuffleId = shuffle?.watchPlaylistEndpoint?.playlistId ?? shuffle?.watchEndpoint?.playlistId
  if (shuffleId) page.shufflePlaylistId = shuffleId
  return page
}
