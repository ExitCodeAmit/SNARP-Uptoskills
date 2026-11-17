import { test } from 'node:test'
import assert from 'node:assert/strict'
import { blockProblem, can, moderationProblem, nextStatus, overrideProblem, PERMISSION_NAMES, requirePermission, roleChangeProblem, ROLES } from './rbac.js'

const run = (middleware, role) => {
  let status = 200
  let nextCalled = false
  const res = { status(code) { status = code; return this }, json() { return this } }
  middleware({ userRole: role }, res, () => { nextCalled = true })
  return { status, nextCalled }
}

test('only the Super Admin holds administrative permissions', () => {
  for (const permission of ['admin.access', 'users.read', 'users.block', 'moderators.manage', 'audit.read', 'papers.override', 'reports.manage']) {
    assert.equal(can(ROLES.SUPER_ADMIN, permission), true, permission)
    assert.equal(can(ROLES.MODERATOR, permission), false, permission)
    assert.equal(can(ROLES.AUTHOR, permission), false, permission)
    assert.equal(can(ROLES.USER, permission), false, permission)
  }
})

test('moderators may moderate papers but members and authors may not', () => {
  assert.equal(can(ROLES.MODERATOR, 'papers.moderate'), true)
  assert.equal(can(ROLES.SUPER_ADMIN, 'papers.moderate'), true)
  assert.equal(can(ROLES.AUTHOR, 'papers.moderate'), false)
  assert.equal(can(ROLES.USER, 'papers.moderate'), false)
  assert.equal(can(undefined, 'papers.moderate'), false)
  assert.equal(can('superadmin', 'admin.access'), false)
})

test('requirePermission rejects with 403 and passes allowed roles through', () => {
  const guard = requirePermission('admin.access')
  assert.deepEqual(run(guard, ROLES.MODERATOR), { status: 403, nextCalled: false })
  assert.deepEqual(run(guard, ROLES.USER), { status: 403, nextCalled: false })
  assert.deepEqual(run(guard, ROLES.SUPER_ADMIN), { status: 200, nextCalled: true })
  assert.throws(() => requirePermission('nope'), /Unknown permission/)
  assert.ok(PERMISSION_NAMES.includes('papers.moderate'))
})

test('role changes cannot create or touch a Super Admin and never apply to yourself', () => {
  const target = { id: 7, role: 'author', email_verified_at: new Date() }
  const admin = { actorId: 1, actorRole: 'admin' }
  assert.equal(roleChangeProblem({ ...admin, target, nextRole: 'moderator' }), null)
  assert.equal(roleChangeProblem({ ...admin, target, nextRole: 'admin' }).status, 400)
  assert.equal(roleChangeProblem({ ...admin, target: { ...target, role: 'admin' }, nextRole: 'user' }).status, 409)
  assert.equal(roleChangeProblem({ ...admin, target: { ...target, id: 1 }, nextRole: 'moderator' }).status, 409)
  assert.equal(roleChangeProblem({ actorId: 7, actorRole: 'moderator', target: { ...target, id: 7 }, nextRole: 'admin' }).status, 403)
  assert.equal(roleChangeProblem({ actorId: 9, actorRole: 'moderator', target, nextRole: 'moderator' }).status, 403)
  assert.equal(roleChangeProblem({ ...admin, target: { ...target, blocked_at: new Date() }, nextRole: 'moderator' }).status, 409)
  assert.equal(roleChangeProblem({ ...admin, target: { ...target, email_verified_at: null }, nextRole: 'moderator' }).status, 409)
  assert.equal(roleChangeProblem({ ...admin, target: null, nextRole: 'moderator' }).status, 404)
})

test('blocking is reserved for the Super Admin and protects admin accounts', () => {
  const target = { id: 5, role: 'user', blocked_at: null }
  assert.equal(blockProblem({ actorId: 1, actorRole: 'admin', target, blocking: true }), null)
  assert.equal(blockProblem({ actorId: 2, actorRole: 'moderator', target, blocking: true }).status, 403)
  assert.equal(blockProblem({ actorId: 1, actorRole: 'admin', target: { ...target, role: 'admin' }, blocking: true }).status, 409)
  assert.equal(blockProblem({ actorId: 5, actorRole: 'admin', target, blocking: true }).status, 409)
  assert.equal(blockProblem({ actorId: 1, actorRole: 'admin', target: { ...target, blocked_at: new Date() }, blocking: true }).status, 409)
  assert.equal(blockProblem({ actorId: 1, actorRole: 'admin', target, blocking: false }).status, 409)
  assert.equal(blockProblem({ actorId: 1, actorRole: 'admin', target: { ...target, blocked_at: new Date() }, blocking: false }), null)
})

test('paper workflow only allows the defined transitions', () => {
  assert.equal(nextStatus('pending', 'start_review'), 'under_review')
  assert.equal(nextStatus('under_review', 'approve'), 'approved')
  assert.equal(nextStatus('pending', 'reject'), 'rejected')
  assert.equal(nextStatus('approved', 'publish'), 'published')
  assert.equal(nextStatus('pending', 'publish'), null)
  assert.equal(nextStatus('coauthor_check', 'approve'), null)
  assert.equal(nextStatus('rejected', 'approve'), null)
  assert.equal(nextStatus('published', 'reject'), null)
  assert.equal(nextStatus('pending', 'unknown'), null)
})

test('moderators cannot review their own papers or papers claimed by someone else', () => {
  const paper = { id: 1, user_id: 10, authors: [{ user_id: 10 }, { user_id: 11 }], status: 'pending', assigned_to: null }
  assert.equal(moderationProblem({ paper, actorId: 20, actorRole: 'moderator', action: 'approve' }), null)
  assert.equal(moderationProblem({ paper, actorId: 10, actorRole: 'moderator', action: 'approve' }).status, 403)
  assert.equal(moderationProblem({ paper, actorId: 11, actorRole: 'admin', action: 'approve' }).status, 403)
  assert.equal(moderationProblem({ paper, actorId: 20, actorRole: 'author', action: 'approve' }).status, 403)
  const claimed = { ...paper, status: 'under_review', assigned_to: 30 }
  assert.equal(moderationProblem({ paper: claimed, actorId: 20, actorRole: 'moderator', action: 'reject' }).status, 409)
  assert.equal(moderationProblem({ paper: claimed, actorId: 30, actorRole: 'moderator', action: 'reject' }), null)
  assert.equal(moderationProblem({ paper: claimed, actorId: 1, actorRole: 'admin', action: 'reject' }), null)
  assert.equal(moderationProblem({ paper: claimed, actorId: 30, actorRole: 'moderator', action: 'start_review' }).status, 409)
  assert.equal(moderationProblem({ paper: { ...paper, status: 'published' }, actorId: 20, actorRole: 'moderator', action: 'approve' }).status, 409)
  assert.equal(moderationProblem({ paper: null, actorId: 20, actorRole: 'moderator', action: 'approve' }).status, 404)
})

test('status overrides need the Super Admin, a valid status and a reason', () => {
  const paper = { status: 'pending' }
  assert.equal(overrideProblem({ paper, actorRole: 'admin', status: 'published', reason: 'Editorial decision' }), null)
  assert.equal(overrideProblem({ paper, actorRole: 'moderator', status: 'published', reason: 'Editorial decision' }).status, 403)
  assert.equal(overrideProblem({ paper, actorRole: 'admin', status: 'coauthor_check', reason: 'Editorial decision' }).status, 400)
  assert.equal(overrideProblem({ paper, actorRole: 'admin', status: 'archived', reason: 'Editorial decision' }).status, 400)
  assert.equal(overrideProblem({ paper, actorRole: 'admin', status: 'rejected', reason: 'no' }).status, 400)
  assert.equal(overrideProblem({ paper, actorRole: 'admin', status: 'pending', reason: 'Editorial decision' }).status, 409)
})
