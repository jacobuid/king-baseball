// Run after `gcloud auth login`. Credentials are sent over stdin, never printed.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { randomBytes } from 'node:crypto'
import { isAbsolute } from 'node:path'

const env = { ...(existsSync('.env') ? parseEnv(readFileSync('.env', 'utf8')) : {}), ...process.env }
const project = env.GCP_PROJECT_ID
const region = env.GCP_REGION || 'us-central1'
const apiOrigin = env.API_ORIGIN
const repo = env.GITHUB_REPOSITORY || 'jacobuid/king-sports'
if (!project || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project)) throw new Error('Set GCP_PROJECT_ID to your Google Cloud project ID')
if (!apiOrigin || new URL(apiOrigin).protocol !== 'https:' || new URL(apiOrigin).origin !== apiOrigin) throw new Error('Set API_ORIGIN to the HTTPS Worker origin (no trailing slash)')
for (const name of ['B2_BOOTSTRAP_KEY_ID', 'B2_BOOTSTRAP_APPLICATION_KEY', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']) if (!env[name]) throw new Error(`${name} is missing from .env or your environment`)
const gcloud = env.GCLOUD_PATH || (process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud')
function run(program, args, input) {
  const options = { env, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  if (process.platform === 'win32' && program.endsWith('.cmd')) {
    const resolved = isAbsolute(program) ? program : execFileSync('where.exe', [program], { env, encoding: 'utf8' }).trim().split(/\r?\n/)[0]
    // cmd.exe is needed for the SDK's batch launcher. Reject shell metacharacters.
    for (const arg of [resolved, ...args]) if (/["&|<>^%!\r\n]/.test(arg)) throw new Error('Unsupported character in CLI argument')
    return execFileSync('cmd.exe', ['/d', '/s', '/c', `"${[resolved, ...args].map(arg => `"${arg}"`).join(' ')}"`], { ...options, windowsVerbatimArguments: true }).trim()
  }
  return execFileSync(program, args, options).trim()
}
const gc = (...args) => run(gcloud, [...args, '--project', project, '--quiet'])
const exists = (...args) => { try { gc(...args); return true } catch { return false } }
async function iamBinding(...args) {
  for (let attempt = 0; ; attempt++) {
    try { return gc(...args) }
    catch (error) {
      if (attempt >= 5 || !/does not exist|not found/i.test(String(error.stderr || ''))) throw error
      console.log('Waiting for the new Google service account to become available…')
      await new Promise(resolve => setTimeout(resolve, 10000))
    }
  }
}
// Verify all tools and identities before provisioning anything.
const accessToken = gc('auth', 'print-access-token')
run('gh', ['auth', 'status'])
const number = gc('projects', 'describe', project, '--format=value(projectNumber)')
const billingAccount = gc('billing', 'projects', 'describe', project, '--format=value(billingAccountName)')
if (!billingAccount) throw new Error('The Google project must have billing enabled')
const budgetResponse = await fetch(`https://billingbudgets.googleapis.com/v1/${billingAccount}/budgets`, { headers: { Authorization: `Bearer ${accessToken}`, 'x-goog-user-project': project } })
if (!budgetResponse.ok) throw new Error('Cannot verify the Cloud Run spending cap. Enable the Billing Budget API and check billing permissions before deploying.')
const budgets = (await budgetResponse.json()).budgets || []
const cap = budgets.find(budget => {
  const filter = budget.budgetFilter || {}
  const amount = budget.amount?.specifiedAmount
  const total = Number(amount?.units || 0) + Number(amount?.nanos || 0) / 1e9
  return filter.projects?.length === 1 && filter.projects[0] === `projects/${number}` && filter.services?.length === 1 && filter.services[0] === 'services/152E-C115-5142' && filter.calendarPeriod === 'MONTH' && filter.creditTypesTreatment === 'EXCLUDE_ALL_CREDITS' && amount?.currencyCode === 'USD' && total > 0 && total <= 1 && budget.spendCap?.outputState === 'CONFIGURED' && !budget.spendCap?.reconciling
})
if (!cap) throw new Error('Deployment stopped: an active Cloud Run spend cap of $1/month or less is required. An alerts-only budget does not qualify.')
console.log('Verified the active monthly Cloud Run spend cap. Configuring Google services…')
gc('services', 'enable', 'run.googleapis.com', 'cloudbuild.googleapis.com', 'artifactregistry.googleapis.com', 'cloudtasks.googleapis.com', 'secretmanager.googleapis.com', 'iam.googleapis.com', 'compute.googleapis.com')
const account = `king-sports-music@${project}.iam.gserviceaccount.com`
console.log('Configuring the music service account, private token, and queue…')
if (!exists('iam', 'service-accounts', 'describe', account)) gc('iam', 'service-accounts', 'create', 'king-sports-music', '--display-name=KingSports music')
await iamBinding('projects', 'add-iam-policy-binding', project, `--member=serviceAccount:${account}`, '--role=roles/cloudtasks.enqueuer', '--condition=None')
await iamBinding('projects', 'add-iam-policy-binding', project, `--member=serviceAccount:${number}-compute@developer.gserviceaccount.com`, '--role=roles/run.builder', '--condition=None')
const secret = 'king-sports-music-token'
let token
if (exists('secrets', 'describe', secret)) token = gc('secrets', 'versions', 'access', 'latest', `--secret=${secret}`)
else {
  gc('secrets', 'create', secret, '--replication-policy=automatic')
  token = randomBytes(32).toString('hex')
  run(gcloud, ['secrets', 'versions', 'add', secret, '--data-file=-', '--project', project, '--quiet'], token)
}
await iamBinding('secrets', 'add-iam-policy-binding', secret, `--member=serviceAccount:${account}`, '--role=roles/secretmanager.secretAccessor')
if (!exists('tasks', 'queues', 'describe', 'king-sports-music', `--location=${region}`)) gc('tasks', 'queues', 'create', 'king-sports-music', `--location=${region}`)
gc('tasks', 'queues', 'update', 'king-sports-music', `--location=${region}`, '--max-concurrent-dispatches=1', '--max-dispatches-per-second=1', '--max-attempts=3', '--min-backoff=30s', '--max-backoff=300s')
const auth = await fetch('https://api.backblazeb2.com/b2api/v4/b2_authorize_account', { headers: { Authorization: 'Basic ' + Buffer.from(`${env.B2_BOOTSTRAP_KEY_ID}:${env.B2_BOOTSTRAP_APPLICATION_KEY}`).toString('base64') } })
if (!auth.ok) throw new Error('B2 authorization failed')
const b2 = await auth.json()
const storage = b2.apiInfo.storageApi
async function b2api(operation, body) {
  const response = await fetch(`${storage.apiUrl}/b2api/v4/${operation}`, { method: 'POST', headers: { Authorization: b2.authorizationToken, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error(`B2 ${operation} failed (${response.status})`)
  return response.json()
}
const bucketName = env.B2_BUCKET || 'king-sports'
const bucket = (await b2api('b2_list_buckets', { accountId: b2.accountId, bucketName })).buckets?.find(b => b.bucketName === bucketName)
if (!bucket) throw new Error('Provision the existing KingSports bucket first')
console.log('Building and deploying the music service…')
const secretBindings = [`MUSIC_SERVICE_TOKEN=${secret}:latest`]
const serviceEnvironment = [`GOOGLE_CLOUD_PROJECT=${project}`, `TASKS_LOCATION=${region}`, 'TASKS_QUEUE=king-sports-music', `API_ORIGIN=${apiOrigin}`, `B2_ENDPOINT=${storage.s3ApiUrl}`]
const youtubeSecret = 'king-sports-youtube-cookies'
if (exists('secrets', 'describe', youtubeSecret) && gc('secrets', 'versions', 'list', youtubeSecret, '--filter=state:ENABLED', '--format=value(name)')) {
  await iamBinding('secrets', 'add-iam-policy-binding', youtubeSecret, `--member=serviceAccount:${account}`, '--role=roles/secretmanager.secretAccessor')
  secretBindings.push(`/secrets/youtube/cookies.txt=${youtubeSecret}:latest`)
  serviceEnvironment.push('YOUTUBE_COOKIES_FILE=/secrets/youtube/cookies.txt')
  console.log('Using the optional YouTube cookie secret (contents are not read by this script).')
}
// Source deployment builds the Dockerfile in Google Cloud; no local Docker needed.
gc('run', 'deploy', 'king-sports-music', '--source=services/music', `--region=${region}`, '--allow-unauthenticated', `--service-account=${account}`, '--cpu=1', '--memory=1Gi', '--concurrency=2', '--min=0', '--max=1', '--max-instances=1', '--no-cpu-boost', '--timeout=900', '--update-env-vars', serviceEnvironment.join(','), '--update-secrets', secretBindings.join(','))
const serviceUrl = gc('run', 'services', 'describe', 'king-sports-music', `--region=${region}`, '--format=value(status.url)')
gc('run', 'services', 'update', 'king-sports-music', `--region=${region}`, `--update-env-vars=SERVICE_URL=${serviceUrl}`)
const key = await b2api('b2_create_key', { accountId: b2.accountId, keyName: `king-sports-music-${Date.now()}`, capabilities: ['readFiles', 'writeFiles', 'deleteFiles'], bucketIds: [bucket.bucketId], namePrefix: 'music/' })
// Install only music secrets, preserving all existing Worker credentials.
const wrangler = 'node_modules/wrangler/bin/wrangler.js'
run(process.execPath, [wrangler, 'secret', 'bulk', '--name', 'king-sports-api', '--config', 'services/api/wrangler.jsonc'], JSON.stringify({ MUSIC_SERVICE_URL: serviceUrl, MUSIC_SERVICE_TOKEN: token, B2_MUSIC_KEY_ID: key.applicationKeyId, B2_MUSIC_APPLICATION_KEY: key.applicationKey }))
run('gh', ['secret', 'set', 'MUSIC_SERVICE_TOKEN', '--repo', repo], token)
// Keep URL as a secret too: it persists across API deployments with no config changes.
run('gh', ['secret', 'set', 'MUSIC_SERVICE_URL', '--repo', repo], serviceUrl)
console.log('Music service deployed and connected. Commit/push the app changes and let API/Web deployments complete.')
