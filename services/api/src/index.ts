import { createClerkClient } from '@clerk/backend'
import { AwsClient } from 'aws4fetch'

interface Env { DB: D1Database; CLERK_SECRET_KEY: string; CLERK_PUBLISHABLE_KEY: string; B2_KEY_ID: string; B2_APPLICATION_KEY: string; B2_ENDPOINT: string; B2_BUCKET: string; WEB_ORIGIN: string }
type Media = { id: string; title: string; description: string; category: string; video_key: string; thumbnail_key: string | null; mime_type: string; created_at: string }

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const allowedKey = (key: string) => key.startsWith('movies/') && !key.includes('..')
function signer(env: Env) { return new AwsClient({ accessKeyId: env.B2_KEY_ID, secretAccessKey: env.B2_APPLICATION_KEY, service: 's3', region: new URL(env.B2_ENDPOINT).hostname.split('.')[1] }) }
async function b2Url(env: Env, key: string) {
  const endpoint = env.B2_ENDPOINT.replace(/\/$/, '')
  const path = `${env.B2_BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`
  const url = `${endpoint}/${path}?X-Amz-Expires=300`
  return (await signer(env).sign(url, { aws: { signQuery: true } })).url
}
async function authorize(request: Request, env: Env) {
  const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY, publishableKey: env.CLERK_PUBLISHABLE_KEY })
  const state = await clerk.authenticateRequest(request, { authorizedParties: [env.WEB_ORIGIN] })
  return state.toAuth()?.userId || null
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin')
    const cors = { 'Access-Control-Allow-Origin': origin === env.WEB_ORIGIN ? origin : env.WEB_ORIGIN, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Vary': 'Origin' }
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors })
    try {
      const userId = await authorize(request, env)
      if (!userId) return withCors(json({ error: 'Unauthorized' }, 401), cors)
      const url = new URL(request.url)
      const path = url.pathname
      if (path === '/api/profiles' && request.method === 'GET') {
        const rows = await env.DB.prepare('SELECT id,name FROM profiles WHERE user_id = ? ORDER BY created_at').bind(userId).all()
        return withCors(json(rows.results), cors)
      }
      if (path === '/api/profiles' && request.method === 'POST') {
        const body = await request.json() as { name?: string }
        const name = body.name?.trim()
        if (!name || name.length > 40) return withCors(json({ error: 'Invalid name' }, 400), cors)
        const id = crypto.randomUUID()
        await env.DB.prepare('INSERT INTO profiles(id,user_id,name) VALUES(?,?,?)').bind(id,userId,name).run()
        return withCors(json({ id, name }, 201), cors)
      }
      if ((path === '/api/library' || path === '/api/home' || path === '/api/search') && request.method === 'GET') {
        const search = (url.searchParams.get('q') || '').slice(0,100)
        const rows = await env.DB.prepare('SELECT * FROM media WHERE title LIKE ? ORDER BY created_at DESC LIMIT 200').bind(`%${search}%`).all<Media>()
        const result = await Promise.all(rows.results.map(async m => ({ id:m.id,title:m.title,description:m.description,category:m.category,mimeType:m.mime_type,createdAt:m.created_at,thumbnailUrl:m.thumbnail_key && allowedKey(m.thumbnail_key) ? await b2Url(env,m.thumbnail_key) : null })))
        return withCors(json(result), cors)
      }
      const mediaMatch = path.match(/^\/api\/media\/([^/]+)(\/play)?$/)
      if (mediaMatch) {
        const m = await env.DB.prepare('SELECT * FROM media WHERE id = ?').bind(mediaMatch[1]).first<Media>()
        if (!m) return withCors(json({ error:'Not found' },404),cors)
        if (!mediaMatch[2] && request.method === 'GET') return withCors(json({ id:m.id,title:m.title,description:m.description,category:m.category }),cors)
        if (mediaMatch[2] && request.method === 'POST') {
          if (!allowedKey(m.video_key)) return withCors(json({ error:'Invalid media key' },500),cors)
          const body = await request.json() as { profileId?: string }
          const profile = await env.DB.prepare('SELECT id FROM profiles WHERE id = ? AND user_id = ?').bind(body.profileId,userId).first()
          if (!profile) return withCors(json({ error:'Forbidden' },403),cors)
          return withCors(json({ url:await b2Url(env,m.video_key),mimeType:m.mime_type }),cors)
        }
      }
      if (path === '/api/progress' && request.method === 'POST') {
        const body = await request.json() as { profileId?: string; mediaId?: string; positionSeconds?: number }
        if (!Number.isInteger(body.positionSeconds) || body.positionSeconds! < 0) return withCors(json({error:'Invalid position'},400),cors)
        const profile = await env.DB.prepare('SELECT id FROM profiles WHERE id = ? AND user_id = ?').bind(body.profileId,userId).first()
        if (!profile) return withCors(json({error:'Forbidden'},403),cors)
        await env.DB.prepare('INSERT INTO progress(profile_id,media_id,position_seconds) VALUES(?,?,?) ON CONFLICT(profile_id,media_id) DO UPDATE SET position_seconds=excluded.position_seconds, updated_at=CURRENT_TIMESTAMP').bind(body.profileId,body.mediaId,body.positionSeconds).run()
        return withCors(json({ok:true}),cors)
      }
      if (path === '/api/progress' && request.method === 'GET') {
        const profileId = url.searchParams.get('profileId')
        const profile = await env.DB.prepare('SELECT id FROM profiles WHERE id = ? AND user_id = ?').bind(profileId,userId).first()
        if (!profile) return withCors(json({error:'Forbidden'},403),cors)
        const rows = await env.DB.prepare('SELECT media_id AS mediaId, position_seconds AS positionSeconds FROM progress WHERE profile_id = ?').bind(profileId).all()
        return withCors(json(rows.results),cors)
      }
      return withCors(json({error:'Not found'},404),cors)
    } catch (error) {
      console.error(error)
      return withCors(json({error:'Internal error'},500),cors)
    }
  }
} satisfies ExportedHandler<Env>
function withCors(response: Response, headers: Record<string,string>) { for (const [key,value] of Object.entries(headers)) response.headers.set(key,value); return response }
