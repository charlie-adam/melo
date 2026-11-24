import { useSyncExternalStore } from 'react'
import { on, request } from '../bridge/client'
import type { PlayerState } from '../bridge/protocol'
import { createStore, useStore } from '../store'

/** The latest `player.state` from Swift. */
export const playerState = createStore<PlayerState>({ status: 'idle', currentTime: 0, duration: 0, volume: 1, isAd: false })
on('player.state', (state) => playerState.set(state))
// A page that loads while the player is paused would otherwise show nothing until the next change.
request('player.get', {}).then(
  (state) => playerState.set(state),
  () => {},
)

export const usePlayer = () => useStore(playerState)

/** Only the status, so long lists do not re-render on every clock update. */
export const usePlayerStatus = () => useSyncExternalStore(playerState.subscribe, () => playerState.get().status)
