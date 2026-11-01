const keyId = process.env.B2_BOOTSTRAP_KEY_ID
const applicationKey = process.env.B2_BOOTSTRAP_APPLICATION_KEY
const bucketName = process.env.B2_BUCKET || 'king-sports'
const webOrigin = process.env.WEB_ORIGIN
if (!keyId || !applicationKey || !webOrigin) throw new Error('Backblaze credentials and WEB_ORIGIN are required')

const basic = Buffer.from(`${keyId}:${applicationKey}`).toString('base64')
const authorized = await fetch('https://api.backblazeb2.com/b2api/v4/b2_authorize_account', { headers: { Authorization: `Basic ${basic}` } })
if (!authorized.ok) throw new Error(`Backblaze authorization failed (${authorized.status})`)
const auth = await authorized.json()
const storage = auth.apiInfo.storageApi
async function api(operation, body) {
  const response = await fetch(`${storage.apiUrl}/b2api/v4/${operation}`, { method: 'POST', headers: { Authorization: auth.authorizationToken, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error(`${operation} failed (${response.status})`)
  return response.json()
}
const listed = await api('b2_list_buckets', { accountId: auth.accountId, bucketName })
const bucket = listed.buckets?.find(item => item.bucketName === bucketName)
if (!bucket) throw new Error(`Backblaze bucket ${bucketName} was not found`)
const corsRules = [{
  corsRuleName: 'kingSportsWebPlayback',
  allowedOrigins: [webOrigin],
  allowedHeaders: ['content-type', 'range'],
  allowedOperations: ['b2_download_file_by_id', 'b2_download_file_by_name', 's3_get', 's3_head', 's3_put'],
  exposeHeaders: ['content-length', 'content-range', 'content-type'],
  maxAgeSeconds: 3600,
}]
await api('b2_update_bucket', { accountId: auth.accountId, bucketId: bucket.bucketId, bucketType: bucket.bucketType, corsRules, ifRevisionIs: bucket.revision })
console.log('Backblaze CORS supports private KingSports audio uploads and playback.')
