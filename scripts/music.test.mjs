import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { handleMusicRequest, handleMusicCallback, handleMusicContent, musicUploadUrl } from '../services/api/src/music.ts'
import { mergeMusic } from '../apps/web/src/musicApi.js'

const id = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
const player = '33333333-3333-4333-8333-333333333333'
function setup() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(readFileSync(new URL('../services/api/migrations/0008_music.sql', import.meta.url), 'utf8'))
  sqlite.exec(readFileSync(new URL('../services/api/migrations/0009_music_uploads.sql', import.meta.url), 'utf8'))
  const env = { DB: { prepare(sql) {
    let args = []
    return { bind(...values) { args = values; return this }, async first() { return sqlite.prepare(sql).get(...args) || null }, async all() { return { results: sqlite.prepare(sql).all(...args) } }, async run() { return sqlite.prepare(sql).run(...args) } }
  } }, MUSIC_SERVICE_URL: 'https://music.example', MUSIC_SERVICE_TOKEN: 'test-token', B2_MUSIC_KEY_ID: 'test', B2_MUSIC_APPLICATION_KEY: 'test-secret', B2_ENDPOINT: 'https://s3.us-west-004.backblazeb2.com', B2_BUCKET: 'test' }
  const insert = (trackId, owner, status = 'ready', video = 'abcdefghijk') => sqlite.prepare('INSERT INTO music_tracks(id,owner_user_id,video_id,title,object_key,status) VALUES(?,?,?,?,?,?)').run(trackId, owner, video, 'Song', `music/${trackId}.m4a`, status)
  return { env, sqlite, insert }
}
const request = (path = '', body, method = body === undefined ? 'GET' : 'POST', headers = {}) => new Request('https://api.example' + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
const auth = { Authorization: 'Bearer test-token' }

test('music drawer renders the upload control directly below search', () => {
  const source = readFileSync(new URL('../apps/web/src/MusicDrawer.jsx', import.meta.url), 'utf8')
  const search = source.indexOf('id="music-search"')
  const upload = source.indexOf('className={`music-upload')
  assert.ok(search >= 0 && upload > search, 'Upload music control must render after the search input')
  assert.match(source, /type="file"[^>]+onChange=\{uploadSong\}/)
})

test('library, assignments, and playback are isolated by account', async () => {
  const { env, sqlite, insert } = setup()
  try {
    insert(id, 'alice'); insert(other, 'bob')
    const library = await (await handleMusicRequest(request('/api/music'), env, 'alice')).json()
    assert.deepEqual(library.tracks.map(t => t.id), [id])
    assert.equal(library.tracks[0].object_key, undefined)
    assert.equal((await handleMusicRequest(request('/api/music/assign', { target: player, tracks: [other] }, 'PUT'), env, 'alice')).status, 400)
    assert.equal((await handleMusicRequest(request(`/api/music/${other}/play`, {}), env, 'alice')).status, 404)
    assert.equal((await handleMusicRequest(request('/api/music/assign', { target: player, tracks: [id] }, 'PUT'), env, 'alice')).status, 200)
    assert.equal((await handleMusicRequest(request('/api/music/assign', { target: player, tracks: [id, other] }, 'PUT'), env, 'alice')).status, 400)
    const result = await (await handleMusicRequest(request('/api/music'), env, 'alice')).json()
    assert.deepEqual(result.assignments[player], [id])
    assert.deepEqual((await (await handleMusicRequest(request('/api/music'), env, 'bob')).json()).assignments, {})
  } finally { sqlite.close() }
})

test('team playlist order persists independently of player songs and local audio removal', async () => {
  const { env, sqlite, insert } = setup()
  try {
    insert(id, 'alice'); insert(other, 'alice', 'ready', 'ABCDEFGHIJK')
    await handleMusicRequest(request('/api/music/assign', { target: 'team', tracks: [other, id] }, 'PUT'), env, 'alice')
    await handleMusicRequest(request('/api/music/assign', { target: player, tracks: [] }, 'PUT'), env, 'alice')
    const data = await (await handleMusicRequest(request('/api/music'), env, 'alice')).json()
    const team = mergeMusic({ players: [{ id: player }] }, { players: [{ id: player, song: { title: 'Legacy' } }] }, data)
    assert.deepEqual(team.teamSongs.map(t => t.id), [other, id])
    assert.equal(team.players[0].song, null)
    assert.equal((await handleMusicRequest(request('/api/music/assign', { target: 'team', tracks: [id, id] }, 'PUT'), env, 'alice')).status, 400)
  } finally { sqlite.close() }
})

test('imports validate IDs, deduplicate, recover queue failures, and throttle search', async () => {
  const { env, sqlite } = setup()
  const original = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => { calls++; return Response.json({ queued: true }) }
  try {
    assert.equal((await handleMusicRequest(request('/api/music/import', { videoId: 'https://evil.example' }), env, 'alice')).status, 400)
    const queued = await handleMusicRequest(request('/api/music/import', { videoId: 'abcdefghijk' }), env, 'alice')
    assert.equal(queued.status, 202)
    const track = (await queued.json()).track
    const again = await (await handleMusicRequest(request('/api/music/import', { videoId: 'abcdefghijk' }), env, 'alice')).json()
    assert.equal(again.track.id, track.id)
    assert.equal(calls, 1)
    globalThis.fetch = async () => { throw new Error('offline') }
    assert.equal((await handleMusicRequest(request('/api/music/import', { videoId: 'ABCDEFGHIJK' }), env, 'alice')).status, 502)
    assert.equal(sqlite.prepare("SELECT status FROM music_tracks WHERE video_id='ABCDEFGHIJK'").get().status, 'failed')
    globalThis.fetch = async () => Response.json({ results: [] })
    assert.equal((await handleMusicRequest(request('/api/music/search?q=test'), env, 'alice')).status, 200)
    assert.equal((await handleMusicRequest(request('/api/music/search?q=test'), env, 'alice')).status, 429)
  } finally { globalThis.fetch = original; sqlite.close() }
})

test('uploaded audio joins the same private library and keeps its playback type', async () => {
  const { env, sqlite } = setup()
  const original = globalThis.fetch
  try {
    const response = await handleMusicRequest(request('/api/music/upload', { title: 'My Song', contentType: 'audio/mpeg', size: 4096, duration: 125 }), env, 'alice')
    assert.equal(response.status, 201)
    const created = await response.json()
    assert.match(created.uploadUrl, /^https:\/\//)
    assert.equal(created.track.title, 'My Song')
    const stored = sqlite.prepare('SELECT * FROM music_tracks WHERE id=?').get(created.track.id)
    assert.equal(stored.owner_user_id, 'alice')
    assert.equal(stored.status, 'processing')
    assert.equal(stored.content_type, 'audio/mpeg')
    assert.match(stored.object_key, /\.mp3$/)
    assert.equal((await handleMusicRequest(request(`/api/music/upload/${created.track.id}/complete`, {}), env, 'bob')).status, 404)
    globalThis.fetch = async () => new Response(null, { status: 200, headers: { 'Content-Length': '4096' } })
    const completed = await handleMusicRequest(request(`/api/music/upload/${created.track.id}/complete`, {}), env, 'alice')
    assert.equal(completed.status, 200)
    assert.equal((await completed.json()).track.status, 'ready')
    assert.equal(sqlite.prepare('SELECT status FROM music_tracks WHERE id=?').get(created.track.id).status, 'ready')
    assert.equal((await handleMusicRequest(request('/api/music/upload', { title: 'Bad', contentType: 'text/plain', size: 10, duration: 10 }), env, 'alice')).status, 400)
  } finally { globalThis.fetch = original; sqlite.close() }
})

test('callback requires service token and verifies object upload before ready', async () => {
  const { env, sqlite, insert } = setup()
  const original = globalThis.fetch
  try {
    insert(id, 'alice', 'queued')
    assert.equal((await handleMusicCallback(request(`/api/internal/music/${id}`, { status: 'ready', duration: 120 }), env)).status, 401)
    globalThis.fetch = async () => new Response(null, { status: 404 })
    assert.equal((await handleMusicCallback(request(`/api/internal/music/${id}`, { status: 'ready', duration: 120 }, 'POST', auth), env)).status, 409)
    assert.equal((await handleMusicCallback(request(`/api/internal/music/${id}`, { status: 'ready', duration: 5000 }, 'POST', auth), env)).status, 400)
    globalThis.fetch = async () => new Response(null, { status: 200, headers: { 'Content-Length': '500' } })
    assert.equal((await musicUploadUrl(request(`/api/internal/music/${id}/upload`, {}, 'POST', auth), env)).status, 200)
    assert.equal((await handleMusicCallback(request(`/api/internal/music/${id}`, { status: 'ready', duration: 120 }, 'POST', auth), env)).status, 200)
    await handleMusicCallback(request(`/api/internal/music/${id}`, { status: 'processing' }, 'POST', auth), env)
    assert.equal(sqlite.prepare('SELECT status FROM music_tracks WHERE id=?').get(id).status, 'ready')
  } finally { globalThis.fetch = original; sqlite.close() }
})

test('search requests a combined result list from the music service', async () => {
  const { env, sqlite } = setup()
  const original = globalThis.fetch
  globalThis.fetch = async (_url, options) => {
    assert.deepEqual(JSON.parse(options.body), { query: 'Artist Song' })
    return Response.json({ results: [] })
  }
  try {
    assert.equal((await handleMusicRequest(request('/api/music/search?q=Artist%20Song'), env, 'alice')).status, 200)
  } finally { globalThis.fetch = original; sqlite.close() }
})

test('Worker playback validates signed links, proxies byte ranges, and never caches audio', async () => {
  const { env, sqlite, insert } = setup()
  const original = globalThis.fetch
  try {
    insert(id, 'alice')
    const { url } = await (await handleMusicRequest(request(`/api/music/${id}/play`, {}), env, 'alice')).json()
    globalThis.fetch = async (incoming, options) => {
      const upstream = incoming instanceof Request ? incoming : new Request(incoming, options)
      assert.equal(upstream.headers.get('Range'), 'bytes=0-9')
      return new Response('1234567890', { status: 206, headers: { 'Content-Range': 'bytes 0-9/100', 'Content-Length': '10' } })
    }
    const response = await handleMusicContent(new Request(url, { headers: { Range: 'bytes=0-9' } }), env)
    assert.equal(response.status, 206)
    assert.equal(response.headers.get('Content-Range'), 'bytes 0-9/100')
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
    assert.equal((await handleMusicContent(new Request(url.replace(id, other)), env)).status, 403)
    const expired = new URL(url); expired.searchParams.set('expires', '1')
    assert.equal((await handleMusicContent(new Request(expired), env)).status, 403)
  } finally { globalThis.fetch = original; sqlite.close() }
})
