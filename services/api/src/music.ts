import { AwsClient } from 'aws4fetch'

export interface MusicEnv {
  DB: D1Database; B2_ENDPOINT: string; B2_BUCKET: string
  B2_MUSIC_KEY_ID: string; B2_MUSIC_APPLICATION_KEY: string
  MUSIC_SERVICE_URL: string; MUSIC_SERVICE_TOKEN: string
}
type Track = { id: string; owner_user_id: string; video_id: string; title: string; artist: string; status: string; object_key: string; content_type: string; duration: number | null; error: string | null; kind: 'song' | 'intro' }
type PlayerAssignment = { id?: string; start?: number; duration?: number; introId?: string; introStart?: number; musicStart?: number; fadeIn?: boolean; fadeOut?: boolean; overlapReduction?: number }
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const publicTrack = (row: Track) => ({ id: row.id, videoId: row.video_id, title: row.title, artist: row.artist, status: row.status, duration: row.duration, error: row.error, kind: row.kind || 'song' })
const uploadTypes: Record<string, string> = { 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/webm': 'webm', 'audio/ogg': 'ogg' }
function configured(env: MusicEnv) { return !!(env.MUSIC_SERVICE_URL && env.MUSIC_SERVICE_TOKEN && env.B2_MUSIC_KEY_ID && env.B2_MUSIC_APPLICATION_KEY) }
function objectUrl(env: MusicEnv, key: string) {
  if (!/^music\/[a-f0-9-]+\.(m4a|mp3|aac|wav|webm|ogg)$/.test(key)) throw new Error('Invalid music key')
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
    if (query.length < 3 || query.length > 100) return json({ error: 'Enter 3–100 characters' }, 400)
    const now = Date.now()
    const limit = await env.DB.prepare('INSERT INTO music_search_limits(owner_user_id,requested_at) VALUES(?,?) ON CONFLICT(owner_user_id) DO UPDATE SET requested_at=excluded.requested_at WHERE music_search_limits.requested_at < ? RETURNING requested_at').bind(userId, now, now - 1500).first()
    if (!limit) return json({ error: 'Please wait a moment before searching again.' }, 429)
    try { return json(await service(env, '/search', { query })) } catch { return json({ error: 'Search is unavailable. Please try again.' }, 502) }
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
  if (path === '/api/music/upload' && request.method === 'POST') {
    if (!configured(env)) return json({ error: 'Music uploads are not configured yet.' }, 503)
    const raw = await request.text()
    if (raw.length > 4096) return json({ error: 'Too large' }, 413)
    const body = JSON.parse(raw) as { title?: string; artist?: string; contentType?: string; size?: number; duration?: number; kind?: string }
    const title = body.title?.trim()
    const artist = body.artist?.trim() || ''
    const contentType = body.contentType?.toLowerCase() || ''
    const extension = uploadTypes[contentType]
    const kind = body.kind === 'intro' ? 'intro' : 'song'
    if (!title || title.length > 200 || artist.length > 100) return json({ error: 'Enter a valid song title' }, 400)
    if (!extension) return json({ error: 'Choose a supported audio file' }, 400)
    if (!Number.isInteger(body.size) || body.size! <= 0 || body.size! > 50 * 1024 * 1024) return json({ error: 'Audio files must be 50 MB or smaller' }, 400)
    if (!Number.isFinite(body.duration) || body.duration! <= 0 || body.duration! > (kind === 'intro' ? 30 : 1200)) return json({ error: kind === 'intro' ? 'Intro audio must be 30 seconds or shorter' : 'Audio must be 20 minutes or shorter' }, 400)
    const id = crypto.randomUUID()
    const objectKey = `music/${id}.${extension}`
    const inserted = await env.DB.prepare("INSERT INTO music_tracks(id,owner_user_id,video_id,title,artist,status,object_key,content_type,duration,kind) SELECT ?,?,?,?,?,?,?,?,?,? WHERE (SELECT count(*) FROM music_tracks WHERE owner_user_id=?) < 500 RETURNING *").bind(id, userId, `upload:${id}`, title, artist, 'processing', objectKey, contentType, body.duration, kind, userId).first<Track>()
    if (!inserted) return json({ error: 'Music library limit reached' }, 429)
    try {
      const signed = await signer(env).sign(`${objectUrl(env, objectKey)}?X-Amz-Expires=900`, { method: 'PUT', headers: { 'Content-Type': contentType }, aws: { signQuery: true } })
      return json({ track: publicTrack(inserted), uploadUrl: signed.url }, 201)
    } catch {
      await env.DB.prepare("UPDATE music_tracks SET status='failed',error='Could not prepare upload.' WHERE id=? AND owner_user_id=?").bind(id, userId).run()
      return json({ error: 'Could not prepare the upload. Please try again.' }, 502)
    }
  }
  const completeUpload = path.match(/^\/api\/music\/upload\/([a-f0-9-]+)\/complete$/i)
  if (completeUpload && request.method === 'POST') {
    const track = await env.DB.prepare("SELECT * FROM music_tracks WHERE id=? AND owner_user_id=? AND video_id=? AND status='processing'").bind(completeUpload[1], userId, `upload:${completeUpload[1]}`).first<Track>()
    if (!track) return json({ error: 'Upload not found' }, 404)
    const stored = await signer(env).fetch(objectUrl(env, track.object_key), { method: 'HEAD' })
    const size = Number(stored.headers.get('Content-Length') || 0)
    if (!stored.ok || size <= 0 || size > 50 * 1024 * 1024) {
      await env.DB.prepare("UPDATE music_tracks SET status='failed',error='Audio upload was incomplete.' WHERE id=?").bind(track.id).run()
      return json({ error: 'Audio upload was incomplete. Please try again.' }, 409)
    }
    await env.DB.prepare("UPDATE music_tracks SET status='ready',error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_user_id=?").bind(track.id, userId).run()
    return json({ track: publicTrack({ ...track, status: 'ready', error: null }) })
  }
  if (path === '/api/music/assign' && request.method === 'PUT') {
    const raw = await request.text()
    if (raw.length > 16000) return json({ error: 'Too large' }, 413)
    const body = JSON.parse(raw) as { target?: string; tracks?: unknown[] }
    const assignmentTarget = typeof body.target === 'string' ? body.target : ''
    const teamTarget = assignmentTarget === 'team' || (assignmentTarget.startsWith('team:') && uuid.test(assignmentTarget.slice(5)))
    if (!teamTarget && !uuid.test(body.target || '')) return json({ error: 'Invalid assignment' }, 400)
    if (teamTarget && body.target !== 'team') {
      const owned = await env.DB.prepare('SELECT 1 FROM teams WHERE id=? AND owner_user_id=?').bind(assignmentTarget.slice(5), userId).first()
      if (!owned) return json({ error: 'Team not found' }, 404)
    }
    if (!Array.isArray(body.tracks) || body.tracks.length > (teamTarget ? 100 : 1)) return json({ error: 'Invalid track list' }, 400)
    const teamEntries = teamTarget ? body.tracks : []
    const playerEntries = teamTarget ? [] : body.tracks
    if (teamEntries.some(id => typeof id !== 'string' || !uuid.test(id)) || new Set(teamEntries).size !== teamEntries.length) return json({ error: 'Invalid track list' }, 400)
    if (playerEntries.some(entry => { const value = entry as PlayerAssignment; return typeof entry !== 'object' || entry === null || (!value.id && !value.introId) || (!!value.id && (!uuid.test(value.id) || !Number.isFinite(value.start) || !Number.isFinite(value.duration))) || (!!value.introId && !uuid.test(value.introId)) || (value.introStart !== undefined && (!Number.isFinite(value.introStart) || value.introStart < 0 || value.introStart > 60)) || (value.musicStart !== undefined && (!Number.isFinite(value.musicStart) || value.musicStart < 0 || value.musicStart > 60)) || (value.fadeIn !== undefined && typeof value.fadeIn !== 'boolean') || (value.fadeOut !== undefined && typeof value.fadeOut !== 'boolean') || (value.overlapReduction !== undefined && (!Number.isFinite(value.overlapReduction) || value.overlapReduction < 0 || value.overlapReduction > .9)) })) return json({ error: 'Choose a valid walk-up' }, 400)
    const normalized: (string | PlayerAssignment)[] = teamTarget ? teamEntries as string[] : playerEntries.map(entry => { const value = entry as PlayerAssignment; return { ...(value.id ? { id: value.id, start: Math.round(value.start! * 10) / 10, duration: Math.round(value.duration! * 10) / 10, ...(value.musicStart !== undefined ? { musicStart: Math.round(value.musicStart * 10) / 10 } : {}), ...(value.fadeIn !== undefined ? { fadeIn: value.fadeIn } : {}), ...(value.fadeOut !== undefined ? { fadeOut: value.fadeOut } : {}), ...(value.overlapReduction !== undefined ? { overlapReduction: Math.round(value.overlapReduction * 100) / 100 } : {}) } : {}), ...(value.introId ? { introId: value.introId, ...(value.introStart !== undefined ? { introStart: Math.round(value.introStart * 10) / 10 } : {}) } : {}) } })
    for (const entry of normalized) {
      const id = typeof entry === 'string' ? entry : entry.id
      const owned = id ? await env.DB.prepare("SELECT id,duration,kind FROM music_tracks WHERE id=? AND owner_user_id=? AND status='ready'").bind(id, userId).first<{ id: string; duration: number | null; kind: string }>() : null
      if (id && !owned) return json({ error: 'Choose an imported song from your library' }, 400)
      if (typeof entry !== 'string' && id && (owned!.kind !== 'song' || entry.start! < 0 || entry.duration! < 3 || entry.duration! > 60 || !owned!.duration || entry.start! + entry.duration! > owned!.duration + .25)) return json({ error: 'Choose a clip between 3 and 60 seconds within the song' }, 400)
      if (typeof entry !== 'string') {
        if (entry.introId) {
          const intro = await env.DB.prepare("SELECT id FROM music_tracks WHERE id=? AND owner_user_id=? AND status='ready' AND kind='intro'").bind(entry.introId, userId).first()
          if (!intro) return json({ error: 'Record or upload a valid announcement' }, 400)
        }
      }
    }
    await env.DB.prepare('INSERT INTO music_assignments(owner_user_id,target,tracks_json) VALUES(?,?,?) ON CONFLICT(owner_user_id,target) DO UPDATE SET tracks_json=excluded.tracks_json').bind(userId, body.target, JSON.stringify(normalized)).run()
    return json({ ok: true })
  }
  const deleteTrack = path.match(/^\/api\/music\/([a-f0-9-]+)$/i)
  if (deleteTrack && request.method === 'DELETE') {
    const track = await env.DB.prepare("SELECT * FROM music_tracks WHERE id=? AND owner_user_id=? AND status IN ('ready','failed')").bind(deleteTrack[1], userId).first<Track>()
    if (!track) return json({ error: 'Song not found or still importing' }, 404)
    try {
      const removed = await signer(env).fetch(objectUrl(env, track.object_key), { method: 'DELETE' })
      if (!removed.ok && removed.status !== 404) return json({ error: 'Could not delete the stored audio. Please try again.' }, 502)
    } catch { return json({ error: 'Could not delete the stored audio. Please try again.' }, 502) }
    await env.DB.prepare('DELETE FROM music_tracks WHERE id=? AND owner_user_id=?').bind(track.id, userId).run()
    const assignments = await env.DB.prepare('SELECT target,tracks_json FROM music_assignments WHERE owner_user_id=?').bind(userId).all<{ target: string; tracks_json: string }>()
    for (const assignment of assignments.results) {
      const tracks = JSON.parse(assignment.tracks_json) as unknown[]
      const filtered = tracks.map<unknown>(entry => {
        if (typeof entry === 'string') return entry === track.id ? null : entry
        const value = entry as PlayerAssignment
        if (value.id === track.id) return value.introId ? { introId: value.introId } : null
        return value.introId === track.id ? (value.id ? { ...value, introId: undefined } : null) : value
      }).filter(entry => entry !== null)
      if (JSON.stringify(filtered) !== JSON.stringify(tracks)) await env.DB.prepare('UPDATE music_assignments SET tracks_json=? WHERE owner_user_id=? AND target=?').bind(JSON.stringify(filtered), userId, assignment.target).run()
    }
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
  const out = new Headers({ 'Content-Type': track.content_type || 'audio/mp4', 'Cache-Control': 'private, no-store', 'Accept-Ranges': 'bytes' })
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
