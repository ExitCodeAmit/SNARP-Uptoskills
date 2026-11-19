function normalize(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function uniqueInterests(researchInterests) {
  const seen = new Set()
  return researchInterests.flatMap((value) => {
    const key = normalize(value)
    if (!key || seen.has(key)) return []
    seen.add(key)
    return [{ key, interest: value.trim() }]
  })
}

function matchingSignals(paper, interest) {
  const tags = Array.isArray(paper.tags) ? paper.tags.map(normalize) : []
  const domain = normalize(paper.domain)
  const title = normalize(paper.title)
  const abstract = normalize(paper.abstract)
  return [
    ...(tags.includes(interest) ? [{ field: 'tag', points: 3 }] : []),
    ...(domain.includes(interest) ? [{ field: 'domain', points: 4 }] : []),
    ...(title.includes(interest) ? [{ field: 'title', points: 2 }] : []),
    ...(abstract.includes(interest) ? [{ field: 'abstract', points: 1 }] : []),
  ]
}

export function scorePaperForInterests(paper, researchInterests) {
  return uniqueInterests(researchInterests).reduce((score, { key }) => (
    score + matchingSignals(paper, key).reduce((sum, signal) => sum + signal.points, 0)
  ), 0)
}

function publicationTime(paper) {
  const date = paper.publication_date ?? paper.created_at
  const time = Date.parse(date)
  return Number.isNaN(time) ? 0 : time
}

export function rankRecommendations(papers, researchInterests, userId, limit = 10) {
  const uniquePapers = new Map()
  for (const paper of papers) {
    const key = String(paper.id)
    if (!uniquePapers.has(key)) uniquePapers.set(key, paper)
  }

  const interests = uniqueInterests(researchInterests)
  return [...uniquePapers.values()]
    .map((paper) => {
      const matchedInterests = interests.flatMap(({ key, interest }) => {
        const signals = matchingSignals(paper, key)
        return signals.length ? [{ interest, signals }] : []
      })
      return {
        ...paper,
        score: matchedInterests.reduce((sum, match) => (
          sum + match.signals.reduce((points, signal) => points + signal.points, 0)
        ), 0),
        matched_interests: matchedInterests,
      }
    })
    .filter((paper) => (
      paper.status === 'approved'
      && String(paper.user_id) !== String(userId)
      && paper.score > 0
    ))
    .sort((a, b) => (
      b.score - a.score
      || publicationTime(b) - publicationTime(a)
      || String(a.id).localeCompare(String(b.id), undefined, { numeric: true })
    ))
    .slice(0, limit)
    .map(({ status, user_id, ...paper }) => paper)
}
