const SORTS = {
  newest: 'COALESCE(p.reviewed_at, p.created_at) DESC, p.id DESC',
  oldest: 'COALESCE(p.reviewed_at, p.created_at) ASC, p.id ASC',
  title_asc: 'lower(p.title) ASC, p.id ASC',
  title_desc: 'lower(p.title) DESC, p.id DESC',
}

const escapedPattern = (value) => `%${value.replace(/[\\%_]/g, '\\$&')}%`

export function buildPaperDiscovery({ q = '', author = '', domain = '', tag = '', sort = 'newest', page = 1, limit = 20 } = {}) {
  const currentPage = Math.max(1, Math.min(100000, Number.parseInt(page, 10) || 1))
  const pageSize = Math.max(1, Math.min(50, Number.parseInt(limit, 10) || 20))
  const conditions = ["p.status = 'approved'"]
  const filterValues = []
  const addFilter = (sql, value) => {
    filterValues.push(value)
    conditions.push(sql(`$${filterValues.length}`))
  }

  const query = typeof q === 'string' ? q.trim().slice(0, 200) : ''
  const authorQuery = typeof author === 'string' ? author.trim().slice(0, 120) : ''
  const domainQuery = typeof domain === 'string' ? domain.trim().slice(0, 120) : ''
  const tagQuery = typeof tag === 'string' ? tag.trim().slice(0, 40) : ''
  if (query) addFilter((param) => `(
    p.title ILIKE ${param} OR p.abstract ILIKE ${param} OR p.domain ILIKE ${param}
    OR COALESCE(p.doi, '') ILIKE ${param} OR array_to_string(p.tags, ' ') ILIKE ${param}
    OR p.authors::text ILIKE ${param} OR u.name ILIKE ${param}
  )`, escapedPattern(query))
  if (authorQuery) addFilter((param) => `(p.authors::text ILIKE ${param} OR u.name ILIKE ${param})`, escapedPattern(authorQuery))
  if (domainQuery) addFilter((param) => `lower(p.domain) = lower(${param})`, domainQuery)
  if (tagQuery) addFilter((param) => `EXISTS (
    SELECT 1 FROM unnest(p.tags) AS paper_tag(value) WHERE paper_tag.value ILIKE ${param}
  )`, escapedPattern(tagQuery))

  const where = conditions.join(' AND ')
  const countValues = [...filterValues]
  const limitParam = filterValues.length + 1
  const offsetParam = filterValues.length + 2
  const values = [...filterValues, pageSize, (currentPage - 1) * pageSize]
  return {
    countSql: `SELECT count(*)::int AS total FROM papers p JOIN users u ON u.id = p.user_id WHERE ${where}`,
    countValues,
    searchSql: `SELECT p.id, p.title, p.abstract, p.doi, p.domain, p.tags, p.authors,
      p.reviewed_at, p.created_at, u.name AS submitter_name
      FROM papers p JOIN users u ON u.id = p.user_id
      WHERE ${where}
      ORDER BY ${SORTS[sort] ?? SORTS.newest}
      LIMIT $${limitParam} OFFSET $${offsetParam}`,
    values,
    page: currentPage,
    limit: pageSize,
  }
}

export const paperSortOptions = Object.keys(SORTS)
