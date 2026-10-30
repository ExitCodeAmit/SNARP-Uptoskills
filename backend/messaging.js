export function validateMessageBody(value) {
  const body = typeof value === 'string' ? value.trim() : ''
  if (!body || body.length > 5000) {
    throw Object.assign(new Error('Message must be 1-5,000 characters'), { field: 'body' })
  }
  return body
}

export function validateRecipientId(value, requesterId) {
  const recipientId = String(value ?? '')
  if (!/^\d+$/.test(recipientId) || Number(recipientId) < 1 || Number(recipientId) > 2147483647 || Number(recipientId) === Number(requesterId)) {
    throw Object.assign(new Error('Choose another valid user'), { field: 'userId' })
  }
  return Number(recipientId)
}
