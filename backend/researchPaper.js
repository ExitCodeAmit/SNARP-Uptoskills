const SIGNALS = [
    /\babstract\b/i,
    /\bintroduction\b/i,
    /\b(?:references|bibliography)\b/i,
    /\b(?:methodology|methods?)\b/i,
    /\bconclusion\b/i,
    /\bkeywords?\b/i,
    /\[\s*\d{1,3}\s*\]|\([A-Z][A-Za-z'’-]+(?:\s+et\s+al\.)?,?\s+(?:19|20)\d{2}[a-z]?\)/,
]

export function researchSignalCount(text) {
    return SIGNALS.reduce((count, pattern) => count + Number(pattern.test(text)), 0)
}

export function chunkText(text, chunkSize = 800) {
    const normalized = String(text ?? '').replace(/\s+/g, ' ').trim()
    if (!normalized) return []

    const chunks = []
    let start = 0
    while (start < normalized.length) {
        let end = Math.min(start + chunkSize, normalized.length)
        if (end < normalized.length) {
            const boundary = normalized.lastIndexOf(' ', end)
            if (boundary > start + Math.floor(chunkSize * 0.6)) end = boundary
        }
        chunks.push(normalized.slice(start, end).trim())
        start = end
    }
    return chunks.filter(Boolean)
}