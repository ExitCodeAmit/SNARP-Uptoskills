import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { imagekitConfig, isFileId, parseReelOptions, parseReelSettings, reelCaptionProblem, reelFileProblem, REEL_FOLDER, uploadAuth } from './reel.js'

const env = { IMAGEKIT_PUBLIC_KEY: 'public_x', IMAGEKIT_PRIVATE_KEY: 'private_y', IMAGEKIT_URL_ENDPOINT: 'https://ik.imagekit.io/demo/' }

test('imagekitConfig needs all three https settings', () => {
  assert.deepEqual(imagekitConfig(env), { publicKey: 'public_x', privateKey: 'private_y', endpoint: 'https://ik.imagekit.io/demo', origin: 'https://ik.imagekit.io' })
  assert.equal(imagekitConfig({ ...env, IMAGEKIT_PRIVATE_KEY: '' }), null)
  assert.equal(imagekitConfig({ ...env, IMAGEKIT_URL_ENDPOINT: 'http://ik.imagekit.io/demo' }), null)
  assert.equal(imagekitConfig({ ...env, IMAGEKIT_URL_ENDPOINT: 'not a url' }), null)
})

test('uploadAuth signs token + expire with the private key', () => {
  const config = imagekitConfig(env)
  const auth = uploadAuth(config, 1_000_000_000)
  assert.equal(auth.expire, 1_000_000 + 30 * 60)
  assert.equal(auth.signature, createHmac('sha1', 'private_y').update(auth.token + auth.expire).digest('hex'))
  assert.equal(auth.publicKey, 'public_x')
  assert.equal(auth.folder, REEL_FOLDER)
  assert.equal('privateKey' in auth, false)
})

test('reelCaptionProblem limits caption length', () => {
  assert.equal(reelCaptionProblem(undefined), '')
  assert.equal(reelCaptionProblem('hello'), '')
  assert.match(reelCaptionProblem('x'.repeat(2201)), /2,200/)
  assert.equal(reelCaptionProblem(5), 'Caption must be text')
})

test('isFileId accepts ImageKit ids only', () => {
  assert.equal(isFileId('6740a1b2c3d4e5f6a7b8c9d0'), true)
  assert.equal(isFileId('../etc'), false)
  assert.equal(isFileId(''), false)
})

test('reelFileProblem only trusts videos in the reels folder of our endpoint', () => {
  const config = imagekitConfig(env)
  const file = { fileType: 'non-image', mime: 'video/mp4', filePath: '/snarp/reels/a.mp4', url: 'https://ik.imagekit.io/demo/snarp/reels/a.mp4', size: 1000, duration: 30 }
  assert.equal(reelFileProblem(file, config), '')
  assert.match(reelFileProblem({ ...file, mime: 'image/png', fileType: 'image' }, config), /MP4/)
  assert.match(reelFileProblem({ ...file, filePath: '/snarp/videos/a.mp4' }, config), /could not be used/)
  assert.match(reelFileProblem({ ...file, url: 'https://evil.example/a.mp4' }, config), /could not be used/)
  assert.match(reelFileProblem({ ...file, size: 101 * 1024 * 1024 }, config), /100 MB/)
  assert.equal(reelFileProblem({ ...file, duration: 600 }, config), '')
  assert.match(reelFileProblem({ ...file, duration: 1000 }, config), /15 minutes/)
  assert.match(reelFileProblem(null, config), /could not be found/)
})

test('parseReelOptions trims, crops and filters', () => {
  const { value } = parseReelOptions({ trimStart: '2.5', trimEnd: '20', crop: '{"aspect":"1:1","zoom":5,"x":-1,"y":0.25}', filter: 'warm', audioMuted: 'true', tags: '[3,3,"7"]', altText: '  A  lab  demo ', location: 'Delhi', hideCounts: 'true' }, 60)
  assert.deepEqual(value, { trimStart: 2.5, trimEnd: 20, crop: { aspect: '1:1', zoom: 3, x: 0, y: 0.25 }, filter: 'warm', audioMuted: true, tags: [3, 7], altText: 'A lab demo', location: 'Delhi', hideCounts: true, commentsOff: false })
})

test('parseReelOptions defaults and drops a trim end at the video end', () => {
  const { value } = parseReelOptions({ trimEnd: '59.99' }, 60)
  assert.equal(value.trimStart, 0)
  assert.equal(value.trimEnd, null)
  assert.deepEqual(value.crop, { aspect: 'original', zoom: 1, x: 0.5, y: 0.5 })
  assert.equal(value.filter, 'none')
  assert.equal(value.audioMuted, false)
})

test('parseReelOptions enforces 1 second to 3 minutes', () => {
  assert.match(parseReelOptions({}, 400).error, /3 minutes/)
  assert.equal(parseReelOptions({ trimStart: 100, trimEnd: 280 }, 400).error, undefined)
  assert.match(parseReelOptions({ trimStart: 5, trimEnd: 5.5 }, 60).error, /at least 1 second/)
  assert.match(parseReelOptions({ trimStart: 8, trimEnd: 4 }, 60).error, /after the start/)
  assert.match(parseReelOptions({ trimStart: 59.5 }, 60).error, /past the end/)
})

test('parseReelOptions rejects bad input', () => {
  assert.match(parseReelOptions({ crop: '{bad' }).error, /crop/)
  assert.match(parseReelOptions({ filter: 'sepia2' }).error, /filters/)
  assert.match(parseReelOptions({ tags: '[0]' }).error, /tagged/)
  assert.match(parseReelOptions({ tags: JSON.stringify(Array.from({ length: 21 }, (_, i) => i + 1)) }).error, /20 people/)
  assert.match(parseReelOptions({ altText: 'x'.repeat(301) }).error, /Alt text/)
  assert.match(parseReelOptions({ location: 'x'.repeat(101) }).error, /Location/)
})

test('parseReelSettings only returns what was sent', () => {
  assert.deepEqual(parseReelSettings({ commentsOff: true }).value, { commentsOff: true })
  assert.deepEqual(parseReelSettings({}).value, {})
})
