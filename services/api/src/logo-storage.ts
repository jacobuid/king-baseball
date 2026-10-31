import { AwsClient } from 'aws4fetch'

export interface LogoStorage {
  put(key: string, dataUrl: string): Promise<void>
  url(key: string): Promise<string>
  remove(key: string): Promise<void>
}
type LogoEnv = { B2_ENDPOINT: string; B2_BUCKET: string; B2_LOGO_KEY_ID: string; B2_LOGO_APPLICATION_KEY: string }

export function createLogoStorage(env: LogoEnv): LogoStorage {
  function client() {
    if (!env.B2_LOGO_KEY_ID || !env.B2_LOGO_APPLICATION_KEY) throw new Error('Logo uploads are not configured. Run Provision infrastructure to install the B2 logo credentials.')
    return new AwsClient({ accessKeyId: env.B2_LOGO_KEY_ID, secretAccessKey: env.B2_LOGO_APPLICATION_KEY, service: 's3', region: new URL(env.B2_ENDPOINT).hostname.split('.')[1] })
  }
  function objectUrl(key: string) {
    if (!/^team-logos\/[a-f0-9-]+\/[a-f0-9-]+\.(png|jpeg|webp)$/.test(key)) throw new Error('Invalid logo file key')
    return `${env.B2_ENDPOINT.replace(/\/$/, '')}/${env.B2_BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`
  }
  return {
    async put(key, dataUrl) {
      const [header, encoded] = dataUrl.split(',')
      const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0))
      const response = await client().fetch(objectUrl(key), {
        method: 'PUT', body: bytes,
        headers: { 'Content-Type': header.slice(5, header.indexOf(';')), 'Cache-Control': 'private, max-age=3600' },
      })
      if (!response.ok) throw new Error('Logo upload failed. Your previous logo has not been changed.')
    },
    async url(key) {
      return (await client().sign(`${objectUrl(key)}?X-Amz-Expires=3600`, { aws: { signQuery: true } })).url
    },
    async remove(key) {
      const response = await client().fetch(objectUrl(key), { method: 'DELETE' })
      if (!response.ok) throw new Error('Could not clean up unused logo upload')
    },
  }
}
