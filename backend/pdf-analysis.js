import { Worker } from 'node:worker_threads'

const PAGES_TO_READ = 5
const ANALYSIS_TIMEOUT_MS = 15000
const MAX_CONCURRENT = 3

export async function extractPdf(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    verbosity: 0,
  })
  const doc = await task.promise
  try {
    const { info = {} } = await doc.getMetadata().catch(() => ({}))
    const lines = []
    const pageCount = Math.min(doc.numPages, PAGES_TO_READ)
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
      const page = await doc.getPage(pageNumber)
      const height = page.getViewport({ scale: 1 }).height
      const content = await page.getTextContent()
      lines.push(...groupLines(content.items, pageNumber, height))
      page.cleanup()
    }
    return {
      info: { title: info.Title ?? '', author: info.Author ?? '', subject: info.Subject ?? '', keywords: info.Keywords ?? '' },
      lines,
      pages: doc.numPages,
    }
  } finally {
    await task.destroy()
  }
}

function groupLines(items, page, pageHeight) {
  const pieces = items
    .filter((item) => typeof item.str === 'string' && item.str.trim())
    .map((item) => ({
      text: item.str,
      x: item.transform[4],
      y: item.transform[5],
      size: Math.round(Math.max(Math.hypot(item.transform[2], item.transform[3]), item.height || 0) * 10) / 10,
    }))
    .sort((a, b) => b.y - a.y || a.x - b.x)
  const lines = []
  for (const piece of pieces) {
    const line = lines.at(-1)
    if (line && Math.abs(line.y - piece.y) <= Math.max(2, Math.min(line.size, piece.size) * 0.4)) {
      line.parts.push(piece)
      if (piece.text.trim().length > 1) line.size = Math.max(line.size, piece.size)
    } else {
      lines.push({ y: piece.y, size: piece.size, parts: [piece] })
    }
  }
  return lines.map((line) => ({
    page,
    top: pageHeight ? Math.round((1 - line.y / pageHeight) * 100) / 100 : 0,
    size: line.size,
    text: line.parts.sort((a, b) => a.x - b.x).map((p) => p.text).join(' ').replace(/\s+/g, ' ').trim(),
  })).filter((line) => line.text)
}

const ABSTRACT_HEAD = /^\s*(?:a\s?b\s?s\s?t\s?r\s?a\s?c\s?t|summary)\b\s*[.:\u2014\u2013-]?\s*/i
const KEYWORDS_HEAD = /^\s*(?:key\s?words?|index\s+terms|subjects?)\s*[.:\u2014\u2013-]+\s*|^\s*(?:key\s?words?|index\s+terms)\s+/i
const SECTION_HEAD = /^\s*(?:(?:\d+|[ivx]+)\.?\s+)?(?:introduction|background|related\s+work|methods?|materials\s+and\s+methods|key\s?words?|index\s+terms|ccs\s+concepts|acm\s+reference)\b/i
const AFFILIATION_WORDS = /\b(?:university|universit[àéä]|institute|institution|department|dept\.?|school|college|laborator(?:y|ies)|lab|cent(?:re|er)|faculty|hospital|academy|inc\.?|ltd\.?|corporation|research|campus|road|street|india|usa|china|germany|france|japan|uk)\b/i
const NOISE = /^(?:arxiv:|preprint|accepted|published|received|copyright|©|doi:|https?:\/\/|www\.|page \d+|vol\.|proceedings)/i
const DOI_PATTERN = /\b(10\.\d{4,9}\/[^\s"<>]+)/i
const STOPWORDS = new Set(('a an and are as at be by for from has have in into is it its of on or that the their this to was were which with we our using use based via towards toward new study paper approach method results show can these than also between both how what when where while not more most such other over under through within without about across after before you your yours i my me us they them he she his her will would should could may might must just like then there here every each any all some one two three get gets got make makes made take takes want need first last next same only even still very much many well back out up down off way ways thing things time times type types use used does did done doing being been into onto per vs etc')
  .split(' '))

const DOMAINS = {
  'Artificial Intelligence': ['chatgpt', 'gpt', 'llm', 'large language model', 'generative', 'openai', 'prompt', 'midjourney', 'stable diffusion', 'diffusion model', 'image generation', 'ai model', 'artificial intelligence', 'machine learning', 'deep learning', 'neural network', 'chatbot', 'nano banana', 'gemini', 'claude'],
  'Computer Science': ['algorithm', 'neural', 'machine learning', 'deep learning', 'software', 'computing', 'transformer', 'dataset', 'artificial intelligence', 'database', 'cyber', 'language model', 'computer vision', 'reinforcement learning', 'classification', 'training', 'benchmark'],
  Mathematics: ['theorem', 'lemma', 'proof', 'algebra', 'topology', 'manifold', 'stochastic', 'polynomial', 'conjecture', 'graph theory'],
  Physics: ['quantum', 'particle', 'relativity', 'photon', 'thermodynamic', 'magnetic', 'laser', 'plasma', 'cosmolog', 'superconduct'],
  Chemistry: ['molecule', 'molecular', 'synthesis', 'catalys', 'reaction', 'compound', 'polymer', 'spectroscop', 'chemical'],
  Biology: ['gene', 'protein', 'cellular', 'dna', 'rna', 'species', 'genom', 'organism', 'evolution', 'enzyme'],
  'Medicine & Health': ['patient', 'clinical', 'disease', 'treatment', 'therapy', 'diagnos', 'cancer', 'health', 'medical', 'symptom'],
  Engineering: ['circuit', 'mechanical', 'structural', 'sensor', 'robot', 'signal processing', 'voltage', 'actuator', 'control system', 'manufactur'],
  'Environmental Science': ['climate', 'environmental', 'pollution', 'ecosystem', 'carbon', 'emission', 'groundwater', 'soil', 'sustainab', 'biodiversity'],
  'Economics & Business': ['market', 'economic', 'financ', 'pricing', 'firms', 'trade', 'investment', 'consumer', 'monetary', 'gdp'],
  Education: ['student', 'teacher', 'learning outcome', 'classroom', 'curriculum', 'education', 'pedagog', 'school', 'learner'],
  Psychology: ['cognitive', 'behavio', 'participants', 'emotion', 'mental health', 'perception', 'anxiety', 'personality'],
  'Social Sciences': ['social', 'society', 'survey', 'community', 'political', 'culture', 'gender', 'migration'],
}

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim()
const joinLines = (lines) => lines.reduce((text, line) => (
  /[a-z]-$/.test(text) && /^[a-z]/.test(line) ? text.slice(0, -1) + line : text ? `${text} ${line}` : line
), '')

const looksLikeFilename = (title) => /\.(?:docx?|pdf|tex|dvi|rtf)$|^untitled|^microsoft word|^document\d*$|^\s*$/i.test(title)

function findTitle(lines, info) {
  const firstPage = lines.filter((l) => l.page === 1 && l.top < 0.6 && l.text.length >= 3 && !NOISE.test(l.text))
  if (firstPage.length) {
    const largest = Math.max(...firstPage.map((l) => l.size))
    const start = firstPage.findIndex((l) => l.size >= largest - 0.5)
    const parts = []
    for (let i = start; i < firstPage.length && parts.length < 4; i++) {
      if (firstPage[i].size < largest - 0.5) break
      parts.push(firstPage[i].text)
    }
    const title = clean(joinLines(parts)).replace(/[*†‡∗]+$/, '')
    const bodySize = median(lines.filter((l) => l.page === 1).map((l) => l.size))
    if (title.length >= 10 && title.length <= 300 && largest > bodySize * 1.15) {
      const endLine = lines.indexOf(firstPage[start + parts.length - 1])
      if (!/\p{Ll}/u.test(title)) {
        const meta = clean(info.title)
        const shared = meta && significantWords(meta).some((w) => significantWords(title).includes(w))
        if (shared && meta.length <= 300 && !looksLikeFilename(meta)) return { value: meta, source: 'metadata', endLine }
        return { value: titleCase(title), source: 'layout', endLine }
      }
      return { value: title, source: 'layout', endLine }
    }
  }
  const meta = clean(info.title)
  if (meta.length >= 10 && meta.length <= 300 && !looksLikeFilename(meta)) return { value: meta, source: 'metadata', endLine: -1 }
  return { value: '', source: null, endLine: -1 }
}

const significantWords = (text) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4 && !STOPWORDS.has(w))

const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'or', 'the', 'to', 'via', 'with'])
function titleCase(text) {
  return text.toLowerCase().split(' ').map((word, i) => (i > 0 && SMALL_WORDS.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1))).join(' ')
}

function median(values) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function findAbstract(lines, info, titleEnd = -1) {
  const start = lines.findIndex((l) => ABSTRACT_HEAD.test(l.text) && l.page <= 2)
  if (start >= 0) {
    const collected = []
    const first = lines[start].text.replace(ABSTRACT_HEAD, '')
    if (first) collected.push(first)
    for (let i = start + 1; i < lines.length && collected.join(' ').length < 6000; i++) {
      const line = lines[i]
      if (SECTION_HEAD.test(line.text) || KEYWORDS_HEAD.test(line.text)) break
      if (NOISE.test(line.text)) continue
      collected.push(line.text)
    }
    const abstract = clean(joinLines(collected))
    if (abstract.length >= 80) return { value: abstract.slice(0, 5000), source: 'text', index: start }
  }
  const subject = clean(info.subject)
  if (subject.length >= 80) return { value: subject.slice(0, 5000), source: 'metadata', index: start }
  const opening = openingParagraph(lines, titleEnd)
  if (opening) return { value: opening, source: 'first-paragraph', index: start }
  return { value: '', source: null, index: start }
}

function openingParagraph(lines, titleEnd) {
  const page1 = lines.slice(titleEnd + 1).filter((l) => l.page === 1)
  for (let i = 0; i < page1.length; i++) {
    const run = []
    for (let j = i; j < page1.length && Math.abs(page1[j].size - page1[i].size) <= 0.25 && !SECTION_HEAD.test(page1[j].text); j++) {
      run.push(page1[j].text)
      if (page1[j].text.length < 45) break
    }
    const text = clean(joinLines(run))
    if (run.length >= 2 && text.length >= 120) return text.slice(0, 3000)
  }
  return ''
}

function splitList(text) {
  return text.split(/[,;·•|]|\s{2,}|\s[-\u2013]\s/)
    .map((t) => clean(t).replace(/^[\d.)\s]+/, '').replace(/[.]+$/, ''))
    .filter((t) => t.length >= 2 && t.length <= 40 && !/^(?:and|or)$/i.test(t))
}

function findKeywords(lines, info) {
  const index = lines.findIndex((l) => KEYWORDS_HEAD.test(l.text) && l.page <= 2)
  if (index >= 0) {
    let text = lines[index].text.replace(KEYWORDS_HEAD, '')
    const next = lines[index + 1]?.text ?? ''
    if (next && !SECTION_HEAD.test(next) && (/[,;]$/.test(text) || next.split(/[,;]/).length > 1) && next.length < 160) text += `, ${next}`
    const tags = dedupe(splitList(text))
    if (tags.length) return { value: tags.slice(0, 12), source: 'text' }
  }
  const meta = dedupe(splitList(clean(info.keywords)))
  if (meta.length) return { value: meta.slice(0, 12), source: 'metadata' }
  return { value: [], source: null }
}

const dedupe = (tags) => {
  const seen = new Set()
  return tags.filter((tag) => {
    const key = tag.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function bodyTags(lines, title) {
  const body = lines.map((l) => l.text).join(' ').slice(0, 30000)
  const words = body.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/).filter(Boolean)
  const useful = (w) => w && w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w) && !/^-/.test(w)
  const counts = new Map()
  for (let i = 0; i < words.length - 1; i++) {
    if (!useful(words[i]) || !useful(words[i + 1])) continue
    const pair = `${words[i]} ${words[i + 1]}`
    counts.set(pair, (counts.get(pair) ?? 0) + 1)
  }
  const singles = new Map()
  for (const w of words) if (useful(w) && w.length >= 5) singles.set(w, (singles.get(w) ?? 0) + 1)
  const titleWords = new Set(significantWords(title))
  const phrases = [...counts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).map(([t]) => t)
  const words1 = [...singles.entries()].filter(([, n]) => n >= 4)
    .sort((a, b) => (b[1] + (titleWords.has(b[0]) ? 5 : 0)) - (a[1] + (titleWords.has(a[0]) ? 5 : 0))).map(([t]) => t)
  const picked = []
  for (const term of [...phrases.slice(0, 6), ...words1]) {
    if (picked.some((p) => p.split(' ').includes(term) || term.split(' ').includes(p))) continue
    picked.push(term)
    if (picked.length === 8) break
  }
  return picked
}

function findNotes(lines, pages) {
  const text = lines.map((l) => l.text)
  const notes = []
  if (pages) notes.push(`The PDF has ${pages} page${pages === 1 ? '' : 's'}.`)
  const arxiv = text.join(' ').match(/arXiv:\s?(\d{4}\.\d{4,5}(?:v\d+)?)/i)
  if (arxiv) notes.push(`Preprint: arXiv:${arxiv[1]}.`)
  const availability = text.find((t) => /(?:code|data|dataset|software|materials?|scripts?)\b.{0,40}\b(?:available|released|shared)|github\.com|zenodo|osf\.io|figshare/i.test(t))
  if (availability) notes.push(`Code and data: ${clean(availability).slice(0, 300)}`)
  const funding = text.find((t) => /\b(?:funded by|supported by|grant (?:no\.?|number)|funding)\b/i.test(t))
  if (funding) notes.push(`Funding: ${clean(funding).slice(0, 300)}`)
  const links = [...new Set((text.join(' ').match(/\bhttps?:\/\/[^\s)>\]]+|\b[a-z0-9-]+\.(?:ai|io|org|com|net|edu|ac\.in|gov)\b(?:\/[^\s)>\]]*)?/gi) ?? [])
    .map((l) => l.replace(/[.,;:]+$/, ''))
    .filter((l) => !/^(?:doi\.org|dx\.doi\.org)/i.test(l.replace(/^https?:\/\//, ''))))].slice(0, 5)
  if (links.length) notes.push(`Links mentioned: ${links.join(', ')}.`)
  return notes.length > 1 ? notes.join('\n') : ''
}

function generateTags(title, abstract) {
  const words = (text) => text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/).filter(Boolean)
  if (abstract.length < 120) return []
  const counts = new Map()
  const inBody = new Set()
  const add = (term, weight, body) => {
    counts.set(term, (counts.get(term) ?? 0) + weight)
    if (body) inBody.add(term)
  }
  for (const [text, weight, body] of [[title, 2, false], [abstract, 1, true]]) {
    const list = words(text)
    for (let i = 0; i < list.length; i++) {
      const a = list[i]
      if (STOPWORDS.has(a) || a.length < 4 || /^\d+$/.test(a)) continue
      add(a, weight, body)
      const b = list[i + 1]
      if (b && !STOPWORDS.has(b) && b.length >= 3 && !/^\d+$/.test(b)) add(`${a} ${b}`, weight * 1.5, body)
    }
  }
  const ranked = [...counts.entries()].filter(([term, n]) => inBody.has(term) && n >= (term.includes(' ') ? 3 : 4)).sort((x, y) => y[1] - x[1]).map(([term]) => term)
  const picked = []
  for (const term of ranked) {
    if (picked.some((p) => p.includes(term) || term.includes(p))) continue
    picked.push(term)
    if (picked.length === 6) break
  }
  return picked
}

function findDoi(lines, info) {
  for (const text of [info.subject, info.keywords, ...lines.map((l) => l.text)]) {
    const match = String(text ?? '').match(DOI_PATTERN)
    if (match) return match[1].replace(/[.,;:)\]}>]+$/, '')
  }
  return ''
}

const NAME_WORD = /^(?:\p{Lu}[\p{L}'’-]*\.?|\p{Lu}\.(?:\p{Lu}\.)*|van|von|de|der|del|da|di|la|le|bin|al|el)$/u

function cleanName(token) {
  return clean(token
    .replace(/\S+@\S+/g, '')
    .replace(/[\d*†‡§¶∗#^,]+/g, ' ')
    .replace(/\b(?:and|by)\b/gi, ' '))
}

const NOT_NAME_WORDS = new Set(('image images video videos code codes shortcut shortcuts guide edition chapter contents introduction table figure abstract keywords volume issue page journal proceedings conference report paper research study analysis review learning model models data system systems network networks free trial setup how what why new top best part section appendix summary overview results methods discussion conclusion references').split(' '))

function isName(text) {
  const words = text.split(' ')
  return words.length >= 2 && words.length <= 5 && text.length <= 60 &&
    words.every((w) => NAME_WORD.test(w)) && !AFFILIATION_WORDS.test(text) &&
    /\p{Ll}/u.test(text) && !words.some((w) => NOT_NAME_WORDS.has(w.toLowerCase().replace(/\.$/, '')))
}

function findAuthors(lines, info, titleEnd, abstractIndex) {
  if (titleEnd >= 0) {
    const end = abstractIndex > titleEnd ? abstractIndex : Math.min(lines.length, titleEnd + 12)
    const block = lines.slice(titleEnd + 1, end).filter((l) => l.page === 1 && !NOISE.test(l.text))
    const names = []
    const affiliations = []
    for (const line of block) {
      if (AFFILIATION_WORDS.test(line.text) || /@/.test(line.text)) {
        if (AFFILIATION_WORDS.test(line.text)) {
          const marker = line.text.match(/^\s*(\d{1,2})\s*(?=\p{L})/u)?.[1] ?? null
          affiliations.push({ marker, text: clean(line.text.replace(/^[\d*†‡§¶∗\s]+/, '').replace(/\S+@\S+/g, '')).slice(0, 200) })
        }
        continue
      }
      for (const token of line.text.split(/;|\band\b|&|·|,(?!\s*\d)/)) {
        const name = cleanName(token)
        if (isName(name)) names.push({ name, marker: token.match(/\p{L}\.?\s*(\d{1,2})/u)?.[1] ?? null })
      }
    }
    const authorBlock = abstractIndex > titleEnd || affiliations.length > 0 || names.some((n) => n.marker) || block.some((l) => /@/.test(l.text))
    if (names.length && authorBlock) {
      const byMarker = new Map(affiliations.filter((a) => a.marker).map((a) => [a.marker, a.text]))
      const shared = affiliations.length === 1 && (!affiliations[0].marker || names.every((n) => !n.marker)) ? affiliations[0].text : ''
      const seen = new Set()
      return {
        value: names.filter(({ name }) => !seen.has(name.toLowerCase()) && seen.add(name.toLowerCase())).slice(0, 25)
          .map(({ name, marker }) => ({ name, affiliation: (marker && byMarker.get(marker)) || shared })),
        source: 'text',
      }
    }
  }
  const meta = clean(info.author)
  if (meta) {
    const names = meta.split(/,|;|\band\b|&/).map(cleanName).filter((n) => n.length >= 3 && n.length <= 120)
    if (names.length) return { value: dedupeNames(names).slice(0, 25).map((name) => ({ name, affiliation: '' })), source: 'metadata' }
  }
  return { value: [], source: null }
}

const dedupeNames = (names) => [...new Map(names.map((n) => [n.toLowerCase(), n])).values()]

function guessDomain(text) {
  const haystack = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ')} `
  let best = null
  for (const [domain, terms] of Object.entries(DOMAINS)) {
    const score = terms.reduce((sum, term) => sum + (haystack.split(new RegExp(`\\b${term}`, 'g')).length - 1), 0)
    if (score >= 3 && (!best || score > best.score)) best = { domain, score }
  }
  return best?.domain ?? ''
}

export function analyseExtracted({ info = {}, lines = [], pages = 0 }) {
  const textFound = lines.reduce((n, l) => n + l.text.length, 0) >= 200
  const title = findTitle(lines, info)
  const abstract = findAbstract(lines, info, title.endLine)
  const keywords = findKeywords(lines, info)
  const realAbstract = abstract.source === 'text' || abstract.source === 'metadata'
  const tags = keywords.value.length ? keywords
    : { value: realAbstract ? generateTags(title.value, abstract.value) : bodyTags(lines, title.value), source: 'generated' }
  const authors = findAuthors(lines, info, title.endLine, abstract.index)
  const domain = guessDomain([title.value, title.value, title.value, abstract.value, keywords.value.join(' '), lines.map((l) => l.text).join(' ').slice(0, 30000)].join(' '))
  return {
    pages,
    text_found: textFound,
    title: title.value,
    abstract: abstract.value,
    authors: authors.value,
    tags: tags.value.filter((t) => t.length <= 40).slice(0, 12),
    doi: findDoi(lines, info),
    domain,
    notes: findNotes(lines, pages),
    sources: { title: title.source, abstract: abstract.source, authors: authors.source, tags: tags.value.length ? tags.source : null },
    looks_like_paper: abstract.source === 'text' || authors.source === 'text' || keywords.source === 'text',
  }
}

let running = 0

export function analysePdf(buffer, { timeoutMs = ANALYSIS_TIMEOUT_MS } = {}) {
  if (running >= MAX_CONCURRENT) return Promise.reject(Object.assign(new Error('Analysis is busy'), { code: 'busy' }))
  running++
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./pdf-analysis-worker.js', import.meta.url), {
      workerData: { data: new Uint8Array(buffer) },
      resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 64 },
    })
    let settled = false
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      running--
      clearTimeout(timer)
      worker.terminate().catch(() => {})
      fn(value)
    }
    const timer = setTimeout(() => finish(reject, Object.assign(new Error('PDF analysis timed out'), { code: 'timeout' })), timeoutMs)
    worker.once('message', (message) => (message.error
      ? finish(reject, Object.assign(new Error(message.error), { code: 'unreadable' }))
      : finish(resolve, message.result)))
    worker.once('error', (err) => finish(reject, Object.assign(err, { code: 'unreadable' })))
    worker.once('exit', (code) => finish(reject, Object.assign(new Error(`PDF worker exited with code ${code}`), { code: 'unreadable' })))
  })
}
