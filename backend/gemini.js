export async function generateWithGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is missing from backend/.env')
  }

  const response = await fetch(
   'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json'
        }
      })
    }
  )

  const data = await response.json()

  if (!response.ok) {
    throw new Error(
      data.error?.message || 'Gemini API request failed'
    )
  }

  const output = data.candidates?.[0]?.content?.parts
    ?.map(part => part.text || '')
    .join('')

  if (!output) {
    throw new Error('Gemini returned an empty response')
  }

  return output
}