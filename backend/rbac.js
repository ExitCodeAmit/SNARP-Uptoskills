export const ROLES = Object.freeze({
  SUPER_ADMIN: 'admin',
  MODERATOR: 'moderator',
  AUTHOR: 'author',
  USER: 'user',
})

export const ROLE_LABELS = Object.freeze({
  admin: 'Super Admin',
  moderator: 'Moderator',
  author: 'Author',
  user: 'Member',
})

const { SUPER_ADMIN, MODERATOR, AUTHOR } = ROLES

const PERMISSIONS = Object.freeze({
  'admin.access': [SUPER_ADMIN],
  'users.read': [SUPER_ADMIN],
  'users.block': [SUPER_ADMIN],
  'moderators.manage': [SUPER_ADMIN],
  'audit.read': [SUPER_ADMIN],
  'reports.manage': [SUPER_ADMIN],
  'papers.override': [SUPER_ADMIN],
  'papers.moderate': [SUPER_ADMIN, MODERATOR],
  'papers.read_any': [SUPER_ADMIN, MODERATOR],
  'papers.submit': [SUPER_ADMIN, AUTHOR],
})

export const PERMISSION_NAMES = Object.freeze(Object.keys(PERMISSIONS))

export function can(role, permission) {
  return PERMISSIONS[permission]?.includes(role) ?? false
}

export function requirePermission(permission, message = 'You do not have permission to do that') {
  if (!PERMISSIONS[permission]) throw new Error(`Unknown permission: ${permission}`)
  return (req, res, next) => {
    if (!can(req.userRole, permission)) return res.status(403).json({ error: message, code: 'forbidden' })
    next()
  }
}

export const ASSIGNABLE_ROLES = Object.freeze([MODERATOR, AUTHOR, ROLES.USER])

export function roleChangeProblem({ actorId, actorRole, target, nextRole }) {
  if (!can(actorRole, 'moderators.manage')) return { status: 403, error: 'Only the Super Admin can change roles' }
  if (!ASSIGNABLE_ROLES.includes(nextRole)) return { status: 400, error: 'Role must be moderator, author or member', field: 'role' }
  if (!target) return { status: 404, error: 'User not found' }
  if (String(target.id) === String(actorId)) return { status: 409, error: 'You cannot change your own role' }
  if (target.role === SUPER_ADMIN) return { status: 409, error: 'Super Admin accounts cannot be changed here' }
  if (target.role === nextRole) return { status: 409, error: `This account is already ${ROLE_LABELS[nextRole].toLowerCase()}` }
  if (nextRole === MODERATOR && target.blocked_at) return { status: 409, error: 'Unblock this account before making it a moderator' }
  if (nextRole === MODERATOR && !target.email_verified_at) return { status: 409, error: 'This account has not confirmed its email yet' }
  return null
}

export function blockProblem({ actorId, actorRole, target, blocking }) {
  if (!can(actorRole, 'users.block')) return { status: 403, error: 'Only the Super Admin can block or unblock accounts' }
  if (!target) return { status: 404, error: 'User not found' }
  if (String(target.id) === String(actorId)) return { status: 409, error: 'You cannot block your own account' }
  if (target.role === SUPER_ADMIN) return { status: 409, error: 'Super Admin accounts cannot be blocked' }
  if (blocking && target.blocked_at) return { status: 409, error: 'This account is already blocked' }
  if (!blocking && !target.blocked_at) return { status: 409, error: 'This account is not blocked' }
  return null
}

export const PAPER_STATUSES = Object.freeze(['coauthor_check', 'pending', 'under_review', 'revision_requested', 'approved', 'rejected', 'published'])
export const PUBLIC_STATUS = 'published'

const TRANSITIONS = Object.freeze({
  start_review: { from: ['pending'], to: 'under_review' },
  release: { from: ['under_review'], to: 'pending' },
  approve: { from: ['pending', 'under_review'], to: 'approved' },
  reject: { from: ['pending', 'under_review'], to: 'rejected' },
  request_revision: { from: ['pending', 'under_review'], to: 'revision_requested' },
  publish: { from: ['approved'], to: 'published' },
})

export function nextStatus(current, action) {
  const rule = TRANSITIONS[action]
  return rule && rule.from.includes(current) ? rule.to : null
}

export function transitionSources(action) {
  return TRANSITIONS[action]?.from ?? []
}

export function moderationProblem({ paper, actorId, actorRole, action }) {
  if (!can(actorRole, 'papers.moderate')) return { status: 403, error: 'Moderator access required' }
  if (!paper) return { status: 404, error: 'Paper not found' }
  const own = String(paper.user_id) === String(actorId) ||
    (paper.authors ?? []).some((a) => String(a.user_id) === String(actorId))
  if (own) return { status: 403, error: 'You cannot moderate a paper you wrote or co-authored' }
  if (!nextStatus(paper.status, action)) {
    return { status: 409, error: paper.status === 'under_review' && action === 'start_review' ? 'Another moderator is already reviewing this paper' : 'This paper is not waiting for that decision' }
  }
  const claimedByOther = paper.status === 'under_review' && paper.assigned_to && String(paper.assigned_to) !== String(actorId)
  if (claimedByOther && actorRole !== SUPER_ADMIN) return { status: 409, error: 'Another moderator is reviewing this paper' }
  return null
}

export function overrideProblem({ paper, actorRole, status, reason }) {
  if (!can(actorRole, 'papers.override')) return { status: 403, error: 'Only the Super Admin can change a paper status directly' }
  if (!PAPER_STATUSES.includes(status) || status === 'coauthor_check') {
    return { status: 400, error: 'Choose pending, under review, revision requested, approved, rejected or published', field: 'status' }
  }
  if (typeof reason !== 'string' || reason.trim().length < 5 || reason.trim().length > 2000) {
    return { status: 400, error: 'Give a reason of 5 to 2,000 characters', field: 'reason' }
  }
  if (!paper) return { status: 404, error: 'Paper not found' }
  if (paper.status === status) return { status: 409, error: 'The paper already has this status' }
  return null
}
