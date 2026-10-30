const text = (value) => typeof value === 'string' ? value.trim() : ''

function list(value, field, maxItems, maxLength) {
  if (!Array.isArray(value)) throw Object.assign(new Error(`${field} must be a list`), { field })
  const items = value.map((item) => text(item)).filter(Boolean)
  if (items.length > maxItems || items.some((item) => item.length > maxLength)) {
    throw Object.assign(new Error(`Use up to ${maxItems} ${field.toLowerCase()}, each ${maxLength} characters or fewer`), { field })
  }
  return [...new Set(items)]
}

export function validateProfileUpdate(body = {}) {
  const name = text(body.name)
  const institution = text(body.institution)
  const department = text(body.department)
  const bio = text(body.bio)
  if (!name || name.length > 100) throw Object.assign(new Error('Name is required and must be 100 characters or fewer'), { field: 'name' })
  if (institution.length > 200) throw Object.assign(new Error('Institution must be 200 characters or fewer'), { field: 'institution' })
  if (department.length > 160) throw Object.assign(new Error('Department must be 160 characters or fewer'), { field: 'department' })
  if (bio.length > 2000) throw Object.assign(new Error('Bio must be 2,000 characters or fewer'), { field: 'bio' })

  const researchInterests = list(body.research_interests ?? [], 'Research interests', 20, 80)
  const skills = list(body.skills ?? [], 'Skills', 30, 60)
  const rawLinks = body.links ?? []
  if (!Array.isArray(rawLinks) || rawLinks.length > 5) {
    throw Object.assign(new Error('Add up to 5 profile links'), { field: 'links' })
  }
  const links = rawLinks.map((entry) => {
    const label = text(entry?.label)
    const url = text(entry?.url)
    let parsed
    try { parsed = new URL(url) } catch { parsed = null }
    if (!label || label.length > 40 || url.length > 500 || !parsed || parsed.protocol !== 'https:') {
      throw Object.assign(new Error('Links need a label and a valid HTTPS address'), { field: 'links' })
    }
    return { label, url: parsed.toString() }
  })

  return { name, institution, department, bio, research_interests: researchInterests, skills, links }
}
