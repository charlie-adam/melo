import { call } from '../api/call'
import type { Suggestions } from '../api/models'
import { parseSuggestions } from '../api/parse/search'
import { suggestions } from '../api/requests'
import { debounce } from '../debounce'

/**
 * Fetches suggestions once typing pauses for 150 ms, and drops any answer that arrives after the input has changed,
 * so a slow reply never replaces a newer one.
 */
export function createSuggester(onResult: (input: string, found: Suggestions) => void) {
  let latest = ''
  const fetch = debounce((input: string) => {
    call(suggestions(input)).then(
      (raw) => latest === input && onResult(input, parseSuggestions(raw)),
      () => {},
    )
  }, 150)
  return {
    type(input: string) {
      latest = input
      if (input.trim()) fetch(input)
      else fetch.cancel()
    },
    cancel: fetch.cancel,
  }
}
