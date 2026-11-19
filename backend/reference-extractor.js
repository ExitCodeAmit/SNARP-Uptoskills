
import { CanvasFactory } from 'pdf-parse/worker';
import { PDFParse } from 'pdf-parse';

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDoi(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, '')
    .replace(/^doi:\s*/, '');
}

export async function extractReferenceMatches(pdfBuffer, approvedPapers) {
  if (!Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0) {
    throw new Error('The uploaded PDF is empty or invalid.');
  }

  const parser = new PDFParse({
    data: new Uint8Array(pdfBuffer),
    CanvasFactory,
  });

  try {
    const parsed = await parser.getText();
    const fullText = String(parsed?.text || '').slice(0, 500000);

    if (fullText.trim().length < 50) {
      return {
        referenceSectionFound: false,
        matches: [],
        message: 'No readable PDF text was found. Scanned PDFs require OCR.'
      };
    }

    const headingPattern =
      /\b(references|bibliography|works cited|literature cited|reference list)\b/gi;

    const headings = [...fullText.matchAll(headingPattern)];
    const lastHeading = headings.at(-1);

    if (!lastHeading) {
      return {
        referenceSectionFound: false,
        matches: [],
        message: 'No References or Bibliography section was found.'
      };
    }

    const referenceText = fullText
      .slice(lastHeading.index + lastHeading[0].length)
      .slice(0, 150000);

    const normalizedReferences = normalizeText(referenceText);

    if (!normalizedReferences) {
      return {
        referenceSectionFound: true,
        matches: [],
        message: 'The reference section contains no readable text.'
      };
    }

    const matches = [];

    for (const paper of approvedPapers) {
      if (!paper?.id || !paper?.title) continue;

      const normalizedTitle = normalizeText(paper.title);
      const normalizedPaperDoi = normalizeText(
        normalizeDoi(paper.doi)
      );

      let matchType = null;
      let matchedText = '';
      let confidence = 0;

      // Strongest match: DOI found in the reference section.
      if (
        normalizedPaperDoi.length >= 7 &&
        normalizedReferences.includes(normalizedPaperDoi)
      ) {
        matchType = 'doi';
        matchedText = normalizedPaperDoi;
        confidence = 0.995;
      }

      // Exact normalized paper-title match.
      else if (
        normalizedTitle.length >= 24 &&
        normalizedTitle.split(' ').length >= 4 &&
        normalizedReferences.includes(normalizedTitle)
      ) {
        matchType = 'title';
        matchedText = normalizedTitle;
        confidence = 0.960;
      }

      if (!matchType) continue;

      const position = normalizedReferences.indexOf(matchedText);

      const evidence = normalizedReferences.slice(
        Math.max(0, position - 140),
        Math.min(
          normalizedReferences.length,
          position + matchedText.length + 180
        )
      );

      matches.push({
        citedPaperId: String(paper.id),
        citedTitle: paper.title,
        matchType,
        confidence,
        evidenceText: evidence.slice(0, 700),
      });
    }

    return {
      referenceSectionFound: true,
      matches,
      message: matches.length
        ? `Found ${matches.length} possible citation match(es).`
        : 'No matching approved SNARP papers were found.'
    };

  } finally {
    await parser.destroy();
  }
}
