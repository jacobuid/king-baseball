import * as pulumi from '@pulumi/pulumi'
import * as cloudflare from '@pulumi/cloudflare'

const config = new pulumi.Config()
const accountId = config.require('cloudflareAccountId')
const projectSlug = config.get('projectSlug') || 'media-library'
const database = new cloudflare.D1Database(projectSlug, { accountId, name: `${projectSlug}-${pulumi.getStack()}` })
export const databaseId = database.uuid
