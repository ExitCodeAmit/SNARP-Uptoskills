
import pg from 'pg';

const pool = new pg.Pool();

function escapePDF(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function createPDF(title, abstract) {
  const lines = [
    'SNARP LOCAL DEMONSTRATION DATASET',
    'DEMO ONLY - NOT A REAL RESEARCH PUBLICATION',
    '',
    `Title: ${title}`,
    '',
    `Abstract: ${abstract}`,
    '',
    'Objective: Demonstrate the SNARP citation workflow.',
    '',
    'Methodology: A fictional test scenario for local development.',
    '',
    'Results: Demonstrates research paper citation connections.',
    '',
    'This document contains synthetic demonstration data only.',
    'Do not use it as scholarly evidence or a real publication.'
  ];

  const commands = ['BT', '/F1 12 Tf', '50 750 Td'];

  for (const [index, line] of lines.entries()) {
    if (index > 0) commands.push('0 -35 Td');
    commands.push(`(${escapePDF(line)}) Tj`);
  }

  commands.push('ET');

  const stream = commands.join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}\nendstream`
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];

  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, 'ascii'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xref = Buffer.byteLength(pdf, 'ascii');

  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;

  for (let i = 1; i < offsets.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;

  return Buffer.from(pdf, 'ascii');
}

const demoPapers = [
  {
    title: '[DEMO ONLY] Edge Computing for Smart Campus Analytics',
    abstract:
      'Synthetic demonstration describing edge computing for smart campus analytics. This record is created exclusively to test SNARP citation registration, research discovery and impact metrics.',
    domain: 'DEMO DATA - NOT SCHOLARLY',
    tags: ['DEMO', 'Edge Computing', 'Smart Campus'],
    filename: 'demo-edge-computing.pdf'
  },
  {
    title: '[DEMO ONLY] Energy-Aware IoT Sensor Networks',
   abstract:
  'Synthetic demonstration describing energy-aware IoT sensor networks. This record is created exclusively to test SNARP citation registration, graph relationships and citation analytics.',
    domain: 'DEMO DATA - NOT SCHOLARLY',
    tags: ['DEMO', 'IoT', 'Sensor Networks'],
    filename: 'demo-iot-networks.pdf'
  }
];

async function main() {
  const email = 'nagashree.s.1829@gmail.com';

  const { rows: users } = await pool.query(
    `SELECT id, name, role
     FROM users
     WHERE LOWER(email) = LOWER($1)`,
    [email]
  );

  if (!users[0] || users[0].role !== 'author') {
    throw new Error(
      'Author account not found or account does not have the author role.'
    );
  }

  const author = users[0];

  console.log(`Using author: ${author.name}`);
  console.log('Creating local DEMO ONLY research records...');

  for (const paper of demoPapers) {
    const existing = await pool.query(
      `SELECT id, title, status
       FROM papers
       WHERE user_id = $1 AND title = $2`,
      [author.id, paper.title]
    );

    if (existing.rows.length > 0) {
      console.log(
        `Already exists: ${paper.title} (${existing.rows[0].status})`
      );
      continue;
    }

    const pdf = createPDF(paper.title, paper.abstract);

    const authors = [
      {
        name: author.name,
        institution: 'SNARP Local Demo Dataset'
      }
    ];

    const result = await pool.query(
      `INSERT INTO papers (
        user_id,
        title,
        abstract,
        domain,
        tags,
        authors,
        pdf_data,
        pdf_filename,
        pdf_content_type,
        pdf_size,
        additional_notes
      )
      VALUES (
        $1, $2, $3, $4, $5, $6::jsonb,
        $7, $8, 'application/pdf', $9, $10
      )
      RETURNING id, title, status`,
      [
        author.id,
        paper.title,
        paper.abstract,
        paper.domain,
        paper.tags,
        JSON.stringify(authors),
        pdf,
        paper.filename,
        pdf.length,
        'LOCAL DEMO ONLY. Synthetic data; not a real research publication.'
      ]
    );

    console.log('Created:', result.rows[0]);
  }

  console.log('\nDemo paper creation completed.');
  console.log('Open Moderator > Paper moderation > Pending.');
  console.log('Approve only the two clearly labelled DEMO ONLY records.');
}

main()
  .catch((error) => {
    console.error('SEED ERROR:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
