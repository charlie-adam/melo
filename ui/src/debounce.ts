/** Calls `fn` once calls stop for `ms`, with the latest arguments. `cancel` drops a pending call. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const call = (...args: A) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
  call.cancel = () => clearTimeout(timer)
  return call
}
