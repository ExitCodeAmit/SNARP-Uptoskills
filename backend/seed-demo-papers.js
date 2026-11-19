import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import pg from 'pg'

const database = process.env.PGDATABASE || 'snarp'
const host = (process.env.PGHOST || 'localhost').toLowerCase()

if (process.env.NODE_ENV !== 'development' || process.env.ALLOW_DEMO_SEED !== 'true') {
  throw new Error('Demo seeding requires NODE_ENV=development and ALLOW_DEMO_SEED=true')
}
if (!['localhost', '127.0.0.1', '::1'].includes(host) || /prod/i.test(database)) {
  throw new Error('Demo seeding is restricted to a local, non-production PostgreSQL database')
}
if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is required; start the backend once to initialize backend/.env')
}

const papers = [
  {
    key: '00000000-0000-4000-8000-000000000001',
    title: 'Interpretable Artificial Intelligence for Early Clinical Risk Assessment',
    abstract: 'This synthetic study explores how interpretable artificial intelligence models can combine structured clinical indicators to support early risk assessment. The example emphasizes transparent evaluation, uncertainty reporting, and clinician oversight rather than autonomous diagnosis.',
    domain: 'Artificial Intelligence in Healthcare',
    publicationDate: '2025-01-15',
    tags: ['Artificial Intelligence', 'Healthcare', 'Clinical Decision Support'],
  },
  {
    key: '00000000-0000-4000-8000-000000000002',
    title: 'Machine Learning Methods for Multi-Horizon Predictive Analysis',
    abstract: 'This synthetic analysis compares supervised machine learning approaches for multi-horizon prediction in changing datasets. It considers temporal validation, calibration, and feature drift to illustrate practical evaluation choices for predictive systems.',
    domain: 'Machine Learning',
    publicationDate: '2025-03-20',
    tags: ['Machine Learning', 'Predictive Analysis', 'Forecasting'],
  },
  {
    key: '00000000-0000-4000-8000-000000000003',
    title: 'Deep Learning Representations for Robust Image Recognition',
    abstract: 'This synthetic paper studies deep learning representations for image recognition under changes in lighting, scale, and background. The example focuses on reproducible data splits, error analysis, and model robustness rather than benchmark claims.',
    domain: 'Deep Learning',
    publicationDate: '2025-05-10',
    tags: ['Deep Learning', 'Image Recognition', 'Neural Networks'],
  },
  {
    key: '00000000-0000-4000-8000-000000000004',
    title: 'Data Science Workflows for Large-Scale Analytics',
    abstract: 'This synthetic study outlines a data science workflow for large-scale analytics, covering data quality checks, distributed feature preparation, and interpretable summaries. It highlights how provenance and validation can improve repeatability in big-data projects.',
    domain: 'Data Science and Big Data Analytics',
    publicationDate: '2025-07-18',
    tags: ['Data Science', 'Big Data', 'Analytics'],
  },
  {
    key: '00000000-0000-4000-8000-000000000005',
    title: 'Natural Language Processing for Evidence-Focused Document Analysis',
    abstract: 'This synthetic investigation examines natural language processing techniques for extracting claims and evidence from long documents. It discusses annotation consistency, retrieval quality, and human review as safeguards for downstream language applications.',
    domain: 'Natural Language Processing',
    publicationDate: '2025-09-02',
    tags: ['Natural Language Processing', 'Text Mining', 'Information Retrieval'],
  },
  {
    key: '00000000-0000-4000-8000-000000000006',
    title: 'Computer Vision for Context-Aware Smart Infrastructure',
    abstract: 'This synthetic work considers computer vision components for context-aware smart systems, including privacy-aware sensing and on-device inference. It describes evaluation dimensions for reliability across varied environments without making deployment claims.',
    domain: 'Computer Vision for Smart Systems',
    publicationDate: '2025-11-12',
    tags: ['Computer Vision', 'Smart Systems', 'Edge Computing'],
  },
  {
    key: '00000000-0000-4000-8000-000000000007',
    title: 'Machine Learning Signals for Adaptive Cybersecurity Monitoring',
    abstract: 'This synthetic study explores machine learning signals for cybersecurity monitoring, with attention to changing baselines, false-positive review, and privacy-conscious evaluation. The example frames automated alerts as analyst support rather than a replacement for incident response.',
    domain: 'Cybersecurity',
    publicationDate: '2026-01-22',
    tags: ['Cybersecurity', 'Machine Learning', 'Anomaly Detection'],
  },
  {
    key: '00000000-0000-4000-8000-000000000008',
    title: 'Resource-Aware Scheduling in Cloud and Distributed Systems',
    abstract: 'This synthetic analysis examines resource-aware scheduling across cloud and distributed systems. It compares workload placement objectives and discusses observability, fault tolerance, and reproducible measurement in heterogeneous computing environments.',
    domain: 'Cloud Computing and Distributed Systems',
    publicationDate: '2026-03-14',
    tags: ['Cloud Computing', 'Distributed Systems', 'Scheduling'],
  },
  {
    key: '00000000-0000-4000-8000-000000000009',
    title: 'Neural Networks for Transparent Intelligent Decision Support',
    abstract: 'This synthetic paper surveys design choices for neural networks used in intelligent decision support. It emphasizes calibration, model inspection, and clear boundaries between predictive assistance and human decisions.',
    domain: 'Neural Networks and Intelligent Systems',
    publicationDate: '2026-05-06',
    tags: ['Neural Networks', 'Artificial Intelligence', 'Intelligent Systems'],
  },
  {
    key: '00000000-0000-4000-8000-000000000010',
    title: 'Interest-Aware Recommendation Systems with Transparent Ranking',
    abstract: 'This synthetic study presents a transparent recommendation-system example that combines stated interests with interpretable ranking signals. It discusses relevance, diversity, and user control as complementary goals for research discovery.',
    domain: 'AI-Based Recommendation Systems',
    publicationDate: '2026-07-28',
    tags: ['Artificial Intelligence', 'Recommendation Systems', 'Personalization'],
  },
]

function escapePdfText(value) {
  return value.replace(/[^\x20-\x7e]/g, ' ').replace(/[\\()]/g, '\\$&')
}

function wrapText(value, width = 82) {
  const lines = []
  let line = ''
  for (const word of value.split(/\s+/)) {
    if (line && `${line} ${word}`.length > width) {
      lines.push(line)
      line = word
    } else {
      line = line ? `${line} ${word}` : word
    }
  }
  if (line) lines.push(line)
  return lines
}

function createDemoPdf(paper) {
  const lines = [
    'DEMO DATA - synthetic example, not a published paper',
    paper.title,
    `Illustrative demo date: ${paper.publicationDate}`,
    ...wrapText(paper.abstract),
  ]
  const stream = [
    'BT',
    '/F1 11 Tf',
    '50 742 Td',
    ...lines.flatMap((line, index) => [
      ...(index ? ['0 -18 Td'] : []),
      `(${escapePdfText(line)}) Tj`,
    ]),
    'ET',
  ].join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}\nendstream`,
  ]

  let document = '%PDF-1.4\n'
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(document, 'ascii'))
    document += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const crossReferenceOffset = Buffer.byteLength(document, 'ascii')
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  document += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${crossReferenceOffset}\n%%EOF\n`
  return Buffer.from(document, 'ascii')
}

async function ensureDemoUser(pool, { name, email, role }) {
  const passwordHash = await bcrypt.hash(randomBytes(32).toString('hex'), 10)
  await pool.query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO NOTHING`,
    [name, email, passwordHash, role]
  )
  const { rows } = await pool.query('SELECT id, role FROM users WHERE email = $1', [email])
  if (!rows[0] || rows[0].role !== role) {
    throw new Error(`The reserved demo account ${email} already exists with an unexpected role`)
  }
  return rows[0].id
}

async function requestApi(baseUrl, path, token, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
  })
  const text = await response.text()
  let result
  try {
    result = text ? JSON.parse(text) : null
  } catch {
    result = { error: text || response.statusText }
  }
  if (!response.ok) {
    throw new Error(`${options.method ?? 'GET'} ${path} failed (${response.status}): ${result?.error ?? response.statusText}`)
  }
  return result
}

const pool = new pg.Pool()
try {
  const [{ rows: schemaRows }, authorId, moderatorId] = await Promise.all([
    pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'papers' AND column_name = 'publication_date'"),
    ensureDemoUser(pool, {
      name: 'SNARP Demo Research Archive',
      email: 'demo-papers@snarp.invalid',
      role: 'author',
    }),
    ensureDemoUser(pool, {
      name: 'SNARP Demo Moderator',
      email: 'demo-moderator@snarp.invalid',
      role: 'moderator',
    }),
  ])
  if (!schemaRows.length) {
    throw new Error('The papers.publication_date migration is missing; start the backend before seeding')
  }

  const apiUrl = `http://localhost:${process.env.PORT || 5000}/api`
  const authorToken = jwt.sign({ sub: authorId }, process.env.JWT_SECRET)
  const moderatorToken = jwt.sign({ sub: moderatorId }, process.env.JWT_SECRET)
  for (const [index, paper] of papers.entries()) {
    const form = new FormData()
    form.set('title', paper.title)
    form.set('abstract', paper.abstract)
    form.set('domain', paper.domain)
    form.set('publicationDate', paper.publicationDate)
    form.set('tags', JSON.stringify([...paper.tags, 'DEMO DATA']))
    form.set('authors', JSON.stringify([{
      name: 'SNARP Demo Research Group',
      affiliation: 'Fictional group; demonstration content only',
    }]))
    form.set('additionalNotes', 'DEMO DATA: Synthetic record and illustrative date for local testing only; not a real publication.')
    form.set('pdf', new Blob([createDemoPdf(paper)], { type: 'application/pdf' }), `DEMO-paper-${index + 1}.pdf`)

    const submitted = await requestApi(apiUrl, '/papers/submit', authorToken, {
      method: 'POST',
      headers: { 'Idempotency-Key': paper.key },
      body: form,
    })
    if (submitted.status === 'pending') {
      await requestApi(apiUrl, `/moderation/papers/${submitted.id}/approve`, moderatorToken, { method: 'PATCH' })
    } else if (submitted.status !== 'approved') {
      throw new Error(`Demo paper ${submitted.id} has unexpected status "${submitted.status}"`)
    }
    console.log(`Seeded demo paper ${index + 1}/10: ${paper.title}`)
  }
  console.log('Demo paper seeding completed through the existing submission and moderation APIs.')
} finally {
  await pool.end()
}
