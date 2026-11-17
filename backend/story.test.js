import test from 'node:test'
import assert from 'node:assert/strict'
import { groupStories, mp4Duration, parseOverlay, sniffVideo, splitVideo, storyCaptionProblem, STORY_CAPTION_MAX, STORY_GROUP_LIMIT } from './story.js'

const row = (id, userId, minutesAgo, seen = false, extra = {}) => ({
  id,
  user_id: userId,
  name: `User ${userId}`,
  avatar_url: null,
  image_url: `/api/images/${id}`,
  caption: '',
  created_at: new Date(Date.now() - minutesAgo * 60000).toISOString(),
  expires_at: new Date(Date.now() + 60000).toISOString(),
  seen,
  view_count: null,
  ...extra,
})

test('groups stories by person with the viewer first, then unseen, then newest', () => {
  const groups = groupStories([
    row(1, 2, 50, true),
    row(2, 3, 40, false),
    row(3, 4, 5, true),
    row(4, 1, 30, false, { view_count: 3 }),
    row(5, 2, 10, true),
  ], 1)
  assert.deepEqual(groups.map((group) => group.user.id), [1, 3, 4, 2])
  assert.equal(groups[0].mine, true)
  assert.equal(groups[0].all_seen, true)
  assert.equal(groups[0].items[0].view_count, 3)
  assert.equal(groups[1].all_seen, false)
  assert.equal('view_count' in groups[1].items[0], false)
})

test('orders each person\'s stories oldest first so they play in order', () => {
  const [group] = groupStories([row(9, 5, 1), row(8, 5, 30), row(7, 5, 10)], 1)
  assert.deepEqual(group.items.map((item) => item.id), [8, 7, 9])
  assert.equal(group.latest, group.items[2].created_at)
})

test('caps the number of people in the row', () => {
  const rows = Array.from({ length: STORY_GROUP_LIMIT + 5 }, (_, i) => row(i + 1, i + 10, i))
  assert.equal(groupStories(rows, 1).length, STORY_GROUP_LIMIT)
})

test('checks story captions', () => {
  assert.equal(storyCaptionProblem(''), '')
  assert.equal(storyCaptionProblem('a'.repeat(STORY_CAPTION_MAX)), '')
  assert.match(storyCaptionProblem('a'.repeat(STORY_CAPTION_MAX + 1)), /200/)
  assert.match(storyCaptionProblem(5), /text/)
})

test('splits a long video into parts of at most 15 seconds', () => {
  assert.deepEqual(splitVideo(12), [{ start: 0, end: 12 }])
  assert.deepEqual(splitVideo(15), [{ start: 0, end: 15 }])
  assert.deepEqual(splitVideo(40), [{ start: 0, end: 15 }, { start: 15, end: 30 }, { start: 30, end: 40 }])
  assert.deepEqual(splitVideo(30.3), [{ start: 0, end: 15 }, { start: 15, end: 30 }])
})

test('recognises MP4, MOV and WebM files and reads the MP4 duration', () => {
  const box = (type, body) => { const head = Buffer.alloc(8); head.writeUInt32BE(8 + body.length); head.write(type, 4, 'latin1'); return Buffer.concat([head, body]) }
  const mvhd = Buffer.alloc(100)
  mvhd.writeUInt32BE(1000, 12)
  mvhd.writeUInt32BE(42500, 16)
  const mp4 = Buffer.concat([box('ftyp', Buffer.from('isom0000')), box('mdat', Buffer.alloc(20)), box('moov', box('mvhd', mvhd))])
  assert.equal(sniffVideo(mp4), 'video/mp4')
  assert.equal(mp4Duration(mp4), 42.5)
  assert.equal(sniffVideo(Buffer.concat([box('ftyp', Buffer.from('qt  0000'))])), 'video/quicktime')
  assert.equal(sniffVideo(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0])), 'video/webm')
  assert.equal(sniffVideo(Buffer.from('not a video at all')), null)
  assert.equal(mp4Duration(Buffer.from('nothing here')), null)
})

test('cleans story text and mention layers', () => {
  const ok = parseOverlay(JSON.stringify([
    { type: 'text', text: '  Hello  ', x: 0.5, y: 0.4, color: '#FF0000', size: 0.5, label: true },
    { type: 'text', text: '   ', x: 0.5, y: 0.5 },
    { type: 'mention', user_id: '7', x: 0.2, y: 0.8, color: 'red' },
  ]))
  assert.deepEqual(ok.layers, [
    { type: 'text', text: 'Hello', x: 0.5, y: 0.4, color: '#ff0000', size: 0.16, label: true },
    { type: 'mention', user_id: 7, x: 0.2, y: 0.8, color: '#ffffff', size: 0.08, label: false },
  ])
  assert.deepEqual(ok.mentionIds, [7])
  assert.match(parseOverlay('[{"type":"text","text":"a","x":2,"y":0}]').error, /inside/)
  assert.match(parseOverlay('{').error, /could not be read/)
  assert.match(parseOverlay(JSON.stringify([{ type: 'text', text: 'x'.repeat(151), x: 0, y: 0 }])).error, /150/)
  assert.match(parseOverlay(JSON.stringify([{ type: 'mention', user_id: 'abc', x: 0, y: 0 }])).error, /friend/)
  assert.deepEqual(parseOverlay('').layers, [])
})
