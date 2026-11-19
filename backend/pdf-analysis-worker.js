import { parentPort, workerData } from 'node:worker_threads'
import { analyseExtracted, extractPdf } from './pdf-analysis.js'

try {
  parentPort.postMessage({ result: analyseExtracted(await extractPdf(workerData.data)) })
} catch (err) {
  parentPort.postMessage({ error: err?.message ?? 'Could not read PDF' })
}
