import { createStore, useStore } from '../store'

export type NowPlayingTab = 'upnext' | 'lyrics' | 'related'

/** Which Now playing panel is open over the main area, if any. */
const view = createStore<NowPlayingTab | undefined>(undefined)

export const openNowPlaying = (tab: NowPlayingTab) => view.set(tab)
export const closeNowPlaying = () => view.set(undefined)
/** Opens the tab, or closes the view when that tab is already showing. */
export const toggleNowPlaying = (tab: NowPlayingTab) => view.set(view.get() === tab ? undefined : tab)
export const useNowPlaying = () => useStore(view)
