import { PDFParse } from 'pdf-parse'

export async function extractPdfText(pdfBuffer) {
  if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer)) {
    throw new Error('Invalid PDF buffer')
  }

  const parser = new PDFParse({ data: pdfBuffer })

  try {
    const result = await parser.getText()
    return result.text || ''
  } finally {
    await parser.destroy()
  }
}