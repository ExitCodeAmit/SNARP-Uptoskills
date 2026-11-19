const STOPWORDS = new Set(`a about above after again against all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its itself just me more most my no nor not now of off on once only or other our ours out over own same she should so some such than that the their theirs them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours
  using based study paper research results result method methods approach analysis new use used via towards toward within without among across et al one two three show shows shown propose proposed present presents work data model models`.split(/\s+/))

const WEIGHT = { interest: 3, own: 2.5, saved: 2, liked: 1.5, commented: 1 }

export const topicKey = (value) => String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim()

export function tokenize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word) && !/^\d+$/.test(word))
    .map(stem)
}

function stem(word) {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (word.length > 4 && word.endsWith('s') && !/(ss|us|is)$/.test(word)) return word.slice(0, -1)
  return word
}

const add = (map, key, amount) => { if (key) map.set(key, (map.get(key) ?? 0) + amount) }

const paperTerms = (paper) => new Set([
  ...tokenize(paper.title),
  ...tokenize(paper.abstract).slice(0, 120),
  ...(paper.tags ?? []).flatMap(tokenize),
])

export function buildProfile({ interests = [], engaged = [], followedIds = [] } = {}) {
  const topics = new Map()
  const domains = new Map()
  const terms = new Map()
  const labels = new Map()
  const sources = new Map()
  const termLabels = new Map()
  const remember = (label, source) => {
    const key = topicKey(label)
    if (!key) return
    if (!labels.has(key)) labels.set(key, String(label).trim())
    if (!sources.has(key)) sources.set(key, source)
  }

  for (const interest of interests) {
    const key = topicKey(interest)
    if (!key) continue
    add(topics, key, WEIGHT.interest)
    remember(interest, 'interest')
    for (const word of tokenize(interest)) {
      add(terms, word, WEIGHT.interest)
      if (!termLabels.has(word)) termLabels.set(word, { label: String(interest).trim(), source: 'interest' })
    }
  }
  for (const { paper, kind } of engaged) {
    const weight = WEIGHT[kind] ?? 1
    for (const tag of paper.tags ?? []) {
      add(topics, topicKey(tag), weight)
      remember(tag, kind)
    }
    add(domains, topicKey(paper.domain), weight)
    remember(paper.domain, kind)
    for (const word of tokenize(paper.title)) {
      add(terms, word, weight * 0.5)
      if (!termLabels.has(word)) termLabels.set(word, { label: word, source: kind })
    }
  }

  return {
    topics,
    domains,
    terms,
    labels,
    sources,
    termLabels,
    followed: new Set(followedIds.map(Number)),
    empty: topics.size === 0 && domains.size === 0 && terms.size === 0 && followedIds.length === 0,
  }
}

export function topInterests(profile, limit = 5) {
  const merged = new Map(profile.topics)
  for (const [key, weight] of profile.domains) add(merged, key, weight)
  return [...merged.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key]) => profile.labels.get(key) ?? key)
}

const SOURCE_TEXT = {
  interest: 'your research interests',
  own: 'your own papers',
  saved: 'papers you saved',
  liked: 'papers you liked',
  commented: 'papers you discussed',
}

export function scorePaper(profile, paper, now = Date.now()) {
  const reasons = []
  let score = 0
  let bestTopic = null

  for (const tag of paper.tags ?? []) {
    const weight = profile.topics.get(topicKey(tag))
    if (!weight) continue
    score += 2 * weight
    if (!bestTopic || weight > bestTopic.weight) bestTopic = { key: topicKey(tag), weight }
  }
  const domainKey = topicKey(paper.domain)
  const domainWeight = (profile.domains.get(domainKey) ?? 0) + (profile.topics.get(domainKey) ?? 0)
  if (domainWeight) {
    score += 1.5 * domainWeight
    if (!bestTopic || domainWeight > bestTopic.weight) bestTopic = { key: domainKey, weight: domainWeight }
  }

  let termScore = 0
  let bestTerm = null
  for (const word of paperTerms(paper)) {
    const weight = profile.terms.get(word) ?? 0
    termScore += weight
    if (weight && (!bestTerm || weight > bestTerm.weight)) bestTerm = { word, weight }
  }
  score += Math.min(termScore, 12) * 0.5

  if (bestTopic) {
    const label = profile.labels.get(bestTopic.key) ?? bestTopic.key
    reasons.push(`Matches ${label}, from ${SOURCE_TEXT[profile.sources.get(bestTopic.key)] ?? 'your activity'}`)
  } else if (bestTerm) {
    const term = profile.termLabels?.get(bestTerm.word)
    reasons.push(term ? `Mentions ${term.label}, from ${SOURCE_TEXT[term.source] ?? 'your activity'}` : 'Close to the topics you follow')
  }

  if (profile.followed.has(Number(paper.user_id))) {
    score += 4
    reasons.push(`By ${paper.submitter_name ?? 'someone'} you follow`)
  }

  const popularity = Number(paper.like_count ?? 0) + 2 * Number(paper.save_count ?? 0)
  score += Math.log1p(popularity) * 0.8
  const published = new Date(paper.published_at ?? paper.reviewed_at ?? paper.created_at).getTime()
  const ageDays = Number.isFinite(published) ? Math.max(0, (now - published) / 86400000) : 365
  score += Math.max(0, 1.5 - ageDays / 60)

  return { score: Math.round(score * 100) / 100, reasons }
}

export function recommendPapers(profile, candidates, { exclude = [], limit = 6, now = Date.now() } = {}) {
  const skip = new Set(exclude.map(String))
  const pool = candidates.filter((paper) => !skip.has(String(paper.id)))
  const scored = pool.map((paper) => ({ paper, ...scorePaper(profile, paper, now) }))
  const byScore = (a, b) => b.score - a.score || Number(b.paper.id) - Number(a.paper.id)
  const personal = scored.filter((item) => item.reasons.length > 0).sort(byScore)
  const rest = scored.filter((item) => item.reasons.length === 0).sort(byScore)
  const titles = new Set()
  const ranked = [...personal, ...rest].filter((item) => {
    const title = topicKey(item.paper.title)
    if (titles.has(title)) return false
    titles.add(title)
    return true
  })

  const picked = []
  const perDomain = new Map()
  for (const item of ranked) {
    const key = topicKey(item.paper.domain)
    if ((perDomain.get(key) ?? 0) >= Math.max(2, Math.ceil(limit / 2)) && ranked.length > limit) continue
    perDomain.set(key, (perDomain.get(key) ?? 0) + 1)
    picked.push(item)
    if (picked.length >= limit) break
  }
  if (picked.length < limit) {
    for (const item of ranked) {
      if (picked.length >= limit) break
      if (!picked.includes(item)) picked.push(item)
    }
  }

  return picked.map(({ paper, score, reasons }) => ({
    ...paper,
    score,
    reasons: reasons.length ? reasons : [Number(paper.like_count) + Number(paper.save_count) > 0 ? 'Popular with other researchers' : 'Recently published'],
  }))
}

export function relatedTopics(profile, candidates, { limit = 8 } = {}) {
  const known = new Set([...profile.topics.keys(), ...profile.domains.keys()])
  const counts = new Map()
  const labels = new Map()
  const because = new Map()
  const note = (label, amount, anchor) => {
    const key = topicKey(label)
    if (!key || known.has(key)) return
    const words = tokenize(label)
    if (words.length && words.every((word) => profile.termLabels?.get(word)?.source === 'interest')) return
    add(counts, key, amount)
    if (!labels.has(key)) labels.set(key, { label: String(label).trim(), kind: 'tag' })
    if (anchor && !because.has(key)) because.set(key, anchor)
  }

  for (const paper of candidates) {
    const keys = [...(paper.tags ?? []).map(topicKey), topicKey(paper.domain)]
    const anchor = keys.find((key) => known.has(key))
    const termHit = !anchor && [...paperTerms(paper)].some((word) => profile.terms.has(word))
    const weight = profile.empty ? 1 : anchor ? 2 : termHit ? 1 : 0
    if (!weight) continue
    for (const tag of paper.tags ?? []) note(tag, weight, anchor)
    note(paper.domain, weight * 0.75, anchor)
    const domainKey = topicKey(paper.domain)
    if (labels.has(domainKey)) labels.get(domainKey).kind = 'domain'
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key, weight]) => {
      const anchor = because.get(key)
      return {
        topic: labels.get(key).label,
        kind: labels.get(key).kind,
        weight: Math.round(weight * 100) / 100,
        because: anchor ? (profile.labels.get(anchor) ?? anchor) : null,
      }
    })
}

export function similarPapers(paper, candidates, { limit = 4 } = {}) {
  const tags = new Set((paper.tags ?? []).map(topicKey))
  const domain = topicKey(paper.domain)
  const terms = paperTerms(paper)
  const people = new Set((paper.authors ?? []).map((author) => topicKey(typeof author === 'string' ? author : author?.name)).filter(Boolean))

  const seenTitles = new Set([topicKey(paper.title)])
  return candidates
    .filter((other) => {
      if (String(other.id) === String(paper.id)) return false
      const title = topicKey(other.title)
      if (seenTitles.has(title)) return false
      seenTitles.add(title)
      return true
    })
    .map((other) => {
      const sharedTags = (other.tags ?? []).filter((tag) => tags.has(topicKey(tag)))
      const otherTerms = paperTerms(other)
      let overlap = 0
      for (const word of otherTerms) if (terms.has(word)) overlap++
      const union = terms.size + otherTerms.size - overlap
      const sharedPeople = (other.authors ?? []).filter((author) => people.has(topicKey(typeof author === 'string' ? author : author?.name)))
      const sameDomain = topicKey(other.domain) === domain
      const score = 2 * sharedTags.length + (sameDomain ? 1 : 0) + (union ? 6 * overlap / union : 0) + 1.5 * sharedPeople.length
      const reason = sharedPeople.length ? 'Shares an author'
        : sharedTags.length ? `Also about ${sharedTags.slice(0, 2).join(' and ')}`
          : sameDomain ? `Also in ${other.domain}` : 'Similar wording'
      return { paper: other, score, reason, signal: sharedTags.length + sharedPeople.length + overlap }
    })
    .filter((item) => item.score >= 1.5 && item.signal > 0)
    .sort((a, b) => b.score - a.score || Number(b.paper.id) - Number(a.paper.id))
    .slice(0, limit)
    .map(({ paper: other, score, reason }) => ({ ...other, score: Math.round(score * 100) / 100, reason }))
}

export function suggestTopics(query, candidates, { limit = 6 } = {}) {
  const q = topicKey(query)
  if (q.length < 2) return []
  const found = new Map()
  const consider = (label, kind) => {
    const key = topicKey(label)
    if (!key || !key.includes(q)) return
    const entry = found.get(key) ?? { topic: String(label).trim(), kind, count: 0, starts: key.startsWith(q) || key.includes(` ${q}`) }
    entry.count++
    if (kind === 'domain') entry.kind = 'domain'
    found.set(key, entry)
  }
  for (const paper of candidates) {
    for (const tag of paper.tags ?? []) consider(tag, 'tag')
    consider(paper.domain, 'domain')
  }
  return [...found.values()]
    .sort((a, b) => Number(b.starts) - Number(a.starts) || b.count - a.count || a.topic.localeCompare(b.topic))
    .slice(0, limit)
    .map(({ topic, kind, count }) => ({ topic, kind, count }))
}
