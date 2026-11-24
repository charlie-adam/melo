import { call } from './api/call'
import { parseAccount, type Account } from './api/parse/account'
import { accountMenu } from './api/requests'
import { on, request } from './bridge/client'
import type { AuthStatus } from './bridge/protocol'
import { createStore, useStore } from './store'

/** Undefined until Swift answers `auth.status`. */
const auth = createStore<AuthStatus | undefined>(undefined)
const account = createStore<Account | undefined>(undefined)

export function startAuth() {
  on('auth.changed', (status) => auth.set(status))
  request('auth.status', {}).then(
    (status) => auth.set(status),
    () => auth.set({ signedIn: false, expired: false }),
  )
}

export async function loadAccount() {
  account.set(parseAccount(await call(accountMenu())))
}

export async function signIn() {
  auth.set(await request('auth.signIn', {}))
}

export async function signOut() {
  auth.set(await request('auth.signOut', {}))
  account.set(undefined)
}

export const useAuth = () => useStore(auth)
export const useAccount = () => useStore(account)
