// Loads committed fixtures for tests. Vite resolves the glob at build time, so this needs no Node types.
const committed = import.meta.glob('./__fixtures__/*.json', { eager: true, import: 'default' })

export function fixture(name: string): unknown {
  const value = committed[`./__fixtures__/${name}.json`]
  if (value === undefined) throw new Error(`No fixture named ${name}`)
  return value
}
