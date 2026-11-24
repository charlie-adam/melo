import type { PlaylistTarget } from '../actions'
import type { Song } from '../api/models'
import { createStore, useStore } from '../store'

export interface MenuRequest {
  song: Song
  x: number
  y: number
  /** The playlist the row sits in, when the user owns it and can remove the row. */
  playlist?: PlaylistTarget
}

const menu = createStore<MenuRequest | undefined>(undefined)

/** Opens the track menu at a point, from a right-click or a row's more button. */
export const openTrackMenu = (song: Song, x: number, y: number, playlist?: PlaylistTarget) => menu.set({ song, x, y, playlist })
export const closeTrackMenu = () => menu.set(undefined)
export const useTrackMenu = () => useStore(menu)
