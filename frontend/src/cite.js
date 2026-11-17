const list = (v) => (Array.isArray(v) ? v : String(v ?? '').split(';')).map((s) => s.trim()).filter(Boolean)

export function apa(m) {
  const authors = list(m.authors)
  const who = authors.length > 1 ? `${authors.slice(0, -1).join(', ')}, & ${authors.at(-1)}` : authors[0]
  const source = [m.journal, m.volume && `${m.volume}${m.issue ? `(${m.issue})` : ''}`, m.pages].filter(Boolean).join(', ')
  return [who, m.year && `(${m.year}).`, m.title && `${m.title}.`, source && `${source}.`, m.doi && `https://doi.org/${m.doi}`]
    .filter(Boolean)
    .join(' ')
}

export function bibtex(m) {
  const authors = list(m.authors)
  const key = `${(authors[0] ?? 'anon').split(',')[0].toLowerCase().replace(/\W/g, '')}${m.year ?? ''}`
  const fields = { author: authors.join(' and '), title: m.title, journal: m.journal, year: m.year, volume: m.volume, number: m.issue, pages: m.pages, doi: m.doi }
  const body = Object.entries(fields)
    .filter(([, v]) => v)
    .map(([k, v]) => `  ${k} = {${v}}`)
    .join(',\n')
  return `@article{${key},\n${body}\n}`
}
