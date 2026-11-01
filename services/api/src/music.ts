import { AwsClient } from 'aws4fetch'

export interface MusicEnv {
  DB: D1Database; B2_ENDPOINT: string; B2_BUCKET: string
  B2_MUSIC_KEY_ID: string; B2_MUSIC_APPLICATION_KEY: string
  MUSIC_SERVICE_URL: string; MUSIC_SERVICE_TOKEN: string
}
type Track = { id: string; owner_user_id: string; video_id: string; title: string; artist: string; status: string; object_key: string; duration: number | null; error: string | null }
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const publicTrack = (row: Track) => ({ id: row.id, videoId: row.video_id, title: row.title, artist: row.artist, status: row.status, duration: row.duration, error: row.error })
function configured(env: MusicEnv) { return !!(env.MUSIC_SERVICE_URL && env.MUSIC_SERVICE_TOKEN && env.B2_MUSIC_KEY_ID && env.B2_MUSIC_APPLICATION_KEY) }
function objectUrl(env: MusicEnv, key: string) {
  if (!/^music\/[a-f0-9-]+\.m4a$/.test(key)) throw new Error('Invalid music key')
  return `${env.B2_ENDPOINT.replace(/\/$/, '')}/${env.B2_BUCKET}/${key}`
}
function signer(env: MusicEnv) { return new AwsClient({ accessKeyId: env.B2_MUSIC_KEY_ID, secretAccessKey: env.B2_MUSIC_APPLICATION_KEY, service: 's3', region: new URL(env.B2_ENDPOINT).hostname.split('.')[1] }) }
async function service(env: MusicEnv, path: string, body: unknown) {
  const response = await fetch(`${env.MUSIC_SERVICE_URL.replace(/\/$/, '')}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.MUSIC_SERVICE_TOKEN}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(25000) })
  if (!response.ok) throw new Error('The music service is unavailable. Please try again.')
  return response.json() as Promise<Record<string, unknown>>
}
export async function handleMusicCallback(request: Request, env: MusicEnv): Promise<Response> {
  // A different server-only token from Clerk. Never exposed in browser responses.
  if (!env.MUSIC_SERVICE_TOKEN || request.headers.get('Authorization') !== `Bearer ${env.MUSIC_SERVICE_TOKEN}`) return json({ error: 'Unauthorized' }, 401)
  const id = new URL(request.url).pathname.split('/').pop() || ''
  if (!uuid.test(id)) return json({ error: 'Invalid track' }, 400)
  const track = await env.DB.prepare('SELECT * FROM music_tracks WHERE id = ?').bind(id).first<Track>()
  if (!track) return json({ error: 'Not found' }, 404)
  if (request.method === 'GET') return json({ status: track.status })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (Number(request.headers.get('Content-Length') || 0) > 4096) return json({ error: 'Too large' }, 413)
  const raw = await request.text()
  if (raw.length > 4096) return json({ error: 'Too large' }, 413)
  const body = JSON.parse(raw) as { status?: string; title?: string; artist?: string; duration?: number }
  if (!['processing', 'ready', 'failed'].includes(body.status || '')) return json({ error: 'Invalid status' }, 400)
  if (track.status === 'ready') return json({ ok: true })
  if (body.status === 'ready') {
    if (!Number.isFinite(body.duration) || body.duration! <= 0 || body.duration! > 1200) return json({ error: 'Invalid duration' }, 400)
    const stored = await signer(env).fetch(objectUrl(env, track.object_key), { method: 'HEAD' })
    if (!stored.ok || Number(stored.headers.get('Content-Length') || 0) <= 0 || Number(stored.headers.get('Content-Length')) > 50 * 1024 * 1024) return json({ error: 'Audio upload missing or invalid' }, 409)
  }
  await env.DB.prepare('UPDATE music_tracks SET status = ?,title = ?,artist = ?,duration = COALESCE(?,duration),error = ?,updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status != ?').bind(body.status, typeof body.title === 'string' ? body.title.slice(0, 200) : track.title, typeof body.artist === 'string' ? body.artist.slice(0, 100) : track.artist, body.duration ?? null, body.status === 'failed' ? 'Import failed. The source may be unavailable; you can retry.' : null, id, 'ready').run()
  return json({ ok: true })
}
export async function handleMusicRequest(request: Request, env: MusicEnv, userId: string): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname
  if (path === '/api/music' && request.method === 'GET') {
    // Recover tasks that exhausted retries or never reached the service.
    await env.DB.prepare("UPDATE music_tracks SET status='failed',error='Import timed out. Please retry.' WHERE owner_user_id=? AND status IN ('queued','processing') AND updated_at < datetime('now','-1 hour')").bind(userId).run()
    const tracks = await env.DB.prepare('SELECT * FROM music_tracks WHERE owner_user_id = ? ORDER BY created_at DESC LIMIT 500').bind(userId).all<Track>()
    const assignments = await env.DB.prepare('SELECT target,tracks_json FROM music_assignments WHERE owner_user_id = ?').bind(userId).all<{ target: string; tracks_json: string }>()
    return json({ configured: configured(env), tracks: tracks.results.map(publicTrack), assignments: Object.fromEntries(assignments.results.map(row => [row.target, JSON.parse(row.tracks_json)])) })
  }
  if (path === '/api/music/search' && request.method === 'GET') {
    if (!configured(env)) return json({ error: 'Music imports are not configured yet.' }, 503)
    const query = url.searchParams.get('q')?.trim() || ''
    const type = url.searchParams.get('type') || 'songs'
    if (!['songs', 'videos'].includes(type)) return json({ error: 'Choose songs or videos' }, 400)
    if (query.length < 3 || query.length > 100) return json({ error: 'Enter 3–100 characters' }, 400)
    const now = Date.now()
    const limit = await env.DB.prepare('INSERT INTO music_search_limits(owner_user_id,requested_at) VALUES(?,?) ON CONFLICT(owner_user_id) DO UPDATE SET requested_at=excluded.requested_at WHERE music_search_limits.requested_at < ? RETURNING requested_at').bind(userId, now, now - 1500).first()
    if (!limit) return json({ error: 'Please wait a moment before searching again.' }, 429)
    try { return json(await service(env, '/search', { query, type })) } catch { return json({ error: 'Search is unavailable. Please try again.' }, 502) }
  }
  if (path === '/api/music/import' && request.method === 'POST') {
    if (!configured(env)) return json({ error: 'Music imports are not configured yet.' }, 503)
    const raw = await request.text()
    if (raw.length > 2048) return json({ error: 'Too large' }, 413)
    const body = JSON.parse(raw) as { videoId?: string }
    if (!/^[A-Za-z0-9_-]{11}$/.test(body.videoId || '')) return json({ error: 'Invalid video' }, 400)
    const existing = await env.DB.prepare('SELECT * FROM music_tracks WHERE owner_user_id = ? AND video_id = ?').bind(userId, body.videoId).first<Track>()
    if (existing && existing.status !== 'failed') return json({ track: publicTrack(existing) })
    const id = existing?.id || crypto.randomUUID()
    // A single SQL write enforces the per-account ceiling under concurrent requests.
    const inserted = await env.DB.prepare("INSERT INTO music_tracks(id,owner_user_id,video_id,title,object_key) SELECT ?,?,?,?,? WHERE (SELECT count(*) FROM music_tracks WHERE owner_user_id = ? AND created_at >= datetime('now','-1 day')) < 100 AND (SELECT count(*) FROM music_tracks WHERE owner_user_id = ?) < 500 ON CONFLICT(owner_user_id,video_id) DO UPDATE SET status='queued',error=NULL,updated_at=CURRENT_TIMESTAMP WHERE music_tracks.status='failed' RETURNING id").bind(id, userId, body.videoId, 'Importing song…', `music/${id}.m4a`, userId, userId).first<{ id: string }>()
    if (!inserted) return json({ error: 'Import limit reached. Try again later.' }, 429)
    const callbackUrl = `${url.origin}/api/internal/music/${id}`
    try {
      // Upload URL is issued just before downloading by /upload, not while queued.
      await service(env, '/jobs', { id, videoId: body.videoId, callbackUrl })
    } catch {
      await env.DB.prepare("UPDATE music_tracks SET status='failed',error='Could not queue this import. Please retry.' WHERE id=? AND status='queued'").bind(id).run()
      return json({ error: 'Could not queue the import. Please retry.' }, 502)
    }
    return json({ track: { id, videoId: body.videoId, title: 'Importing song…', artist: '', status: 'queued' } }, 202)
  }
  if (path === '/api/music/assign' && request.method === 'PUT') {
    const raw = await request.text()
    if (raw.length > 16000) return json({ error: 'Too large' }, 413)
    const body = JSON.parse(raw) as { target?: string; tracks?: unknown[] }
    if (body.target !== 'team' && !uuid.test(body.target || '')) return json({ error: 'Invalid assignment' }, 400)
    if (!Array.isArray(body.tracks) || body.tracks.length > (body.target === 'team' ? 100 : 1) || body.tracks.some(id => typeof id !== 'string' || !uuid.test(id)) || new Set(body.tracks).size !== body.tracks.length) return json({ error: 'Invalid track list' }, 400)
    for (const id of body.tracks) {
      const owned = await env.DB.prepare("SELECT id FROM music_tracks WHERE id=? AND owner_user_id=? AND status='ready'").bind(id, userId).first()
      if (!owned) return json({ error: 'Choose an imported song from your library' }, 400)
    }
    await env.DB.prepare('INSERT INTO music_assignments(owner_user_id,target,tracks_json) VALUES(?,?,?) ON CONFLICT(owner_user_id,target) DO UPDATE SET tracks_json=excluded.tracks_json').bind(userId, body.target, JSON.stringify(body.tracks)).run()
    return json({ ok: true })
  }
  const play = path.match(/^\/api\/music\/([a-f0-9-]+)\/play$/i)
  if (play && request.method === 'POST') {
    const track = await env.DB.prepare("SELECT * FROM music_tracks WHERE id=? AND owner_user_id=? AND status='ready'").bind(play[1], userId).first<Track>()
    if (!track) return json({ error: 'Song not found' }, 404)
    // Token grants only this object for one hour. Audio requests need no Clerk header.
    const expires = Math.floor(Date.now() / 1000) + 3600
    const signature = await signPlayback(env, track.id, expires)
    return json({ url: `${url.origin}/content/music/${track.id}?expires=${expires}&signature=${signature}` })
  }
  return json({ error: 'Not found' }, 404)
}
async function signPlayback(env: MusicEnv, id: string, expires: number) {
  if (!env.MUSIC_SERVICE_TOKEN) throw new Error('Music is not configured')
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.MUSIC_SERVICE_TOKEN), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`music:${id}:${expires}`))
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
}
export async function handleMusicContent(request: Request, env: MusicEnv): Promise<Response> {
  const url = new URL(request.url)
  const id = url.pathname.split('/').pop() || ''
  const expires = Number(url.searchParams.get('expires'))
  if (!['GET', 'HEAD'].includes(request.method)) return json({ error: 'Method not allowed' }, 405)
  if (!uuid.test(id) || !Number.isSafeInteger(expires) || expires < Date.now() / 1000 || expires > Date.now() / 1000 + 3605 || url.searchParams.get('signature') !== await signPlayback(env, id, expires)) return json({ error: 'Expired playback link' }, 403)
  const track = await env.DB.prepare("SELECT * FROM music_tracks WHERE id=? AND status='ready'").bind(id).first<Track>()
  if (!track) return json({ error: 'Not found' }, 404)
  const headers: Record<string, string> = {}
  const range = request.headers.get('Range')
  if (range) { if (!/^bytes=\d*-\d*$/.test(range) || range === 'bytes=-') return new Response(null, { status: 416 }); headers.Range = range }
  const response = await signer(env).fetch(objectUrl(env, track.object_key), { method: request.method, headers })
  const out = new Headers({ 'Content-Type': 'audio/mp4', 'Cache-Control': 'private, no-store', 'Accept-Ranges': 'bytes' })
  for (const name of ['Content-Length', 'Content-Range']) { const value = response.headers.get(name); if (value) out.set(name, value) }
  return new Response(response.body, { status: response.status, headers: out })
}
export async function musicUploadUrl(request: Request, env: MusicEnv): Promise<Response> {
  if (!env.MUSIC_SERVICE_TOKEN || request.headers.get('Authorization') !== `Bearer ${env.MUSIC_SERVICE_TOKEN}`) return json({ error: 'Unauthorized' }, 401)
  const id = new URL(request.url).pathname.split('/').at(-2) || ''
  const track = await env.DB.prepare("SELECT * FROM music_tracks WHERE id=? AND status != 'ready'").bind(id).first<Track>()
  if (!track) return json({ error: 'Not found' }, 404)
  const signed = await signer(env).sign(`${objectUrl(env, track.object_key)}?X-Amz-Expires=900`, { method: 'PUT', headers: { 'Content-Type': 'audio/mp4' }, aws: { signQuery: true } })
  return json({ url: signed.url })
}
