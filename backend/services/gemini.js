export async function chat(messages, { json = false } = {}) {
    const apiKey = String(process.env.GEMINI_API_KEY || '').trim()
    if (!apiKey) throw new Error('GEMINI_API_KEY is not configured in the backend environment.')

    const model = String(process.env.GEMINI_MODEL || '').trim() || 'gemini-2.5-flash'
    const systemText = messages
        .filter((message) => message.role === 'system')
        .map((message) => message.content)
        .join('\n\n')
    const contents = messages
        .filter((message) => message.role !== 'system')
        .map((message) => ({
            role: message.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: String(message.content) }],
        }))

    let response
    try {
        response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': apiKey,
            },
            body: JSON.stringify({
                ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
                contents,
                generationConfig: {
                    temperature: 0.2,
                    maxOutputTokens: 1200,
                    ...(json ? { responseMimeType: 'application/json' } : {}),
                },
            }),
            signal: AbortSignal.timeout(30000),
        })
    } catch (error) {
        if (error.name === 'TimeoutError' || error.name === 'AbortError') {
            throw new Error('Gemini took too long to respond. Please try again.')
        }
        throw new Error('Could not connect to Gemini. Check the backend network connection and try again.')
    }

    const result = await response.json().catch(() => ({}))
    if (!response.ok) {
        if (response.status === 429) throw new Error('Gemini quota or rate limit reached. Check the API key project quota.')
        const detail = result.error && result.error.message
        throw new Error(`Gemini API error (${response.status}): ${detail || 'Request was rejected.'}`)
    }

    const candidates = result.candidates || []
    const parts = candidates[0] && candidates[0].content && candidates[0].content.parts
    const content = Array.isArray(parts) ? parts.map((part) => part.text || '').join('').trim() : ''
    if (!content) throw new Error('Gemini returned an empty response.')
    return content
}