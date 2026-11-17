export async function chat(messages, { json = false, stream = false } = {}) {
    const apiKey = String(process.env.GEMINI_API_KEY || '').trim()
    if (!apiKey) throw new Error('GEMINI_API_KEY is not configured in the backend environment.')

    const model = String(process.env.GEMINI_MODEL || '').trim() || 'gemini-2.5-flash'
    const endpoint = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions?key=' + apiKey

    const body = {
        model,
        messages,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
        ...(stream ? { stream: true } : {}),
    }

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        })

        if (stream) {
            return new Promise((resolve, reject) => {
                const chunks = []
                response.body?.on('data', (chunk) => chunks.push(chunk))
                response.body?.on('error', reject)
                response.body?.on('end', () => resolve(Buffer.concat(chunks).toString()))
            })
        }

        const data = await response.json()

        if (!response.ok) {
            if (response.status === 401) throw new Error('Invalid Gemini API key. Please check your GEMINI_API_KEY.')
            if (response.status === 404) throw new Error('Invalid Gemini model. Please check GEMINI_MODEL.')
            if (response.status === 429) throw new Error('Gemini quota or rate limit reached. Check the API key project quota.')
            throw new Error(`Gemini API error (${response.status}): ${data.error?.message || 'Request was rejected.'}`)
        }

        // Handle OpenAI-compatible response format
        if (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) {
            return data.choices[0].message.content
        }
        if (data.response) return data.response
        if (data.content) return data.content
        return JSON.stringify(data)
    } catch (error) {
        if (error.message.includes('GEMINI_API_KEY')) throw error
        if (error.name === 'AbortError' || error.name === 'TimeoutError') {
            throw new Error('Gemini took too long to respond. Please try again.')
        }
        throw new Error(`AI service error: ${error.message || 'Unknown error'}`)
    }
}