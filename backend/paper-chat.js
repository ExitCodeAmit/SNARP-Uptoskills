// Paper chat (PR #19): index the text of published papers into searchable passages, find the passages that
// match a question, and ask the AI to answer only from them. Gemini is used when GEMINI_API_KEY is set
// (the author's original provider); otherwise the Groq key that powers the SNARP Guide.
import { chunkText } from './researchPaper.js'
import { extractPdfText } from './dedup.js'
import { chat as geminiChat } from './services/ai.js'

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
export const MAX_EXCERPTS = 6

export function chatProvider(env = process.env) {
  if (env.GEMINI_API_KEY?.trim()) return 'gemini'
  if (env.GROQ_API_KEY?.trim()) return 'groq'
  return null
}

export async function completeChat(messages, { maxTokens = 800, env = process.env, fetchImpl = fetch } = {}) {
  const provider = chatProvider(env)
  if (provider === 'gemini') return String(await geminiChat(messages)).trim()
  if (provider !== 'groq') throw Object.assign(new Error('Paper chat is not set up on this server yet.'), { status: 503 })
  const res = await fetchImpl(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.GROQ_API_KEY.trim()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: env.GROQ_MODEL?.trim() || 'openai/gpt-oss-120b',
      messages,
      temperature: 0.2,
      max_completion_tokens: maxTokens,
      reasoning_effort: 'low',
      include_reasoning: false,
    }),
    signal: AbortSignal.timeout(45000),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    throw Object.assign(new Error(res.status === 429 ? 'The AI is busy right now. Please try again in a minute.' : 'The AI could not answer right now. Please try again.'), { status: res.status === 429 ? 429 : 502 })
  }
  return String(data?.choices?.[0]?.message?.content ?? '').trim()
}

// Reads a published paper's PDF once and stores its passages. Unreadable PDFs are recorded with 0 passages.
export async function indexPaper(pool, paperId) {
  const { rows } = await pool.query("SELECT id, pdf_data FROM papers WHERE id = $1 AND status = 'published'", [paperId])
  if (!rows[0]) return 0
  let chunks = []
  try { chunks = chunkText(await extractPdfText(rows[0].pdf_data)).slice(0, 400) } catch { chunks = [] }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM paper_chunks WHERE paper_id = $1', [paperId])
    if (chunks.length) {
      await client.query(
        `INSERT INTO paper_chunks (paper_id, chunk_index, content, tsv)
         SELECT $1, i - 1, c, to_tsvector('english', c) FROM unnest($2::text[]) WITH ORDINALITY AS t(c, i)`,
        [paperId, chunks],
      )
    }
    await client.query(
      `INSERT INTO paper_chunk_status (paper_id, chunks) VALUES ($1, $2)
       ON CONFLICT (paper_id) DO UPDATE SET chunks = EXCLUDED.chunks, indexed_at = now()`,
      [paperId, chunks.length],
    )
    await client.query('COMMIT')
    return chunks.length
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

// Indexes published papers that have not been indexed yet (a few at a time).
export async function indexPendingPapers(pool, limit = 20) {
  const { rows } = await pool.query(
    `SELECT p.id FROM papers p
     WHERE p.status = 'published' AND NOT EXISTS (SELECT 1 FROM paper_chunk_status s WHERE s.paper_id = p.id)
     ORDER BY p.id LIMIT $1`,
    [limit],
  )
  let done = 0
  for (const { id } of rows) {
    await indexPaper(pool, id)
    done += 1
  }
  return done
}

// The passages that best match the search text, optionally within one paper. Falls back to the
// first passages of that paper when nothing matches (for questions like "summarise this paper").
// "word1 | word2 | ...": a passage matches when it contains any of the question's words.
export function orQuery(text) {
  const words = String(text ?? '').toLowerCase().match(/[a-z0-9]{3,}/g) ?? []
  return [...new Set(words)].slice(0, 30).join(' | ')
}

export async function searchExcerpts(pool, { query, paperId = null, limit = MAX_EXCERPTS }) {
  const terms = orQuery(query)
  const { rows } = !terms ? { rows: [] } : await pool.query(
    `SELECT c.paper_id, p.title, c.chunk_index, c.content,
       ts_rank(c.tsv, to_tsquery('english', $1)) AS rank
     FROM paper_chunks c JOIN papers p ON p.id = c.paper_id
     WHERE p.status = 'published' AND c.tsv @@ to_tsquery('english', $1)
       AND ($2::bigint IS NULL OR c.paper_id = $2)
     ORDER BY rank DESC, c.paper_id, c.chunk_index LIMIT $3`,
    [terms, paperId, limit],
  )
  if (rows.length || !paperId) return rows
  const first = await pool.query(
    `SELECT c.paper_id, p.title, c.chunk_index, c.content FROM paper_chunks c JOIN papers p ON p.id = c.paper_id
     WHERE c.paper_id = $1 AND p.status = 'published' ORDER BY c.chunk_index LIMIT $2`,
    [paperId, limit],
  )
  return first.rows
}
