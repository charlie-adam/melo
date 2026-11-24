import type { Thumbnail } from '../models'
import { findKey, text, thumbnails, type Raw } from './common'

export interface Account {
  name: string
  handle?: string
  photo: Thumbnail[]
}

/** Parses `account/account_menu`: the active account's header. Returns undefined when signed out. */
export function parseAccount(raw: Raw): Account | undefined {
  const header = findKey(raw?.actions, 'activeAccountHeaderRenderer')
  const name = text(header?.accountName)
  if (!name) return undefined
  const account: Account = { name, photo: thumbnails(header.accountPhoto) }
  const handle = text(header.channelHandle)
  if (handle) account.handle = handle
  return account
}
