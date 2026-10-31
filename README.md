# King Baseball

Baseball application foundation using React, Vite, Clerk, Cloudflare Workers, D1, Backblaze B2, Pulumi, GitHub Pages, and GitHub Actions. The React Team screen supports roster creation, walk-up song metadata, local audio attachment and preview, and a bottom Team navigation link. Save Team persists the roster and audio in IndexedDB on the current device, scoped to the signed-in Clerk user; it does not yet sync to the API. The API still contains the original media-library starter.

## Create a project

1. Select **Use this template** on GitHub and create a repository.
2. Create Cloudflare, Clerk, Backblaze, and Pulumi accounts.
3. Add the repository secrets listed below.
4. Add the Clerk publishable key as the repository variable `VITE_CLERK_PUBLISHABLE_KEY`.
5. Run the **Provision infrastructure** workflow.
6. The Web workflow discovers the Baseball Worker URL from Cloudflare automatically. Set the optional repository variable `VITE_API_URL` only to override it (for example, for a custom API domain).
7. Enable GitHub Pages with **GitHub Actions** as its source and run the **Web** workflow.

## Repository secrets

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLERK_SECRET_KEY`
- `CLERK_PUBLISHABLE_KEY`
- `B2_BOOTSTRAP_KEY_ID`
- `B2_BOOTSTRAP_APPLICATION_KEY`
- `PULUMI_ACCESS_TOKEN`

The infrastructure workflow derives resource names from the GitHub owner and repository, provisions a private encrypted B2 bucket and restricted playback key, creates D1 through Pulumi, runs migrations, deploys the Worker, and installs runtime secrets. No generated credentials are committed.

## Deployment setup

Upload the seven secrets and frontend publishable-key variable from your ignored local `.env` without entering them individually:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap-secrets.ps1 -Repo jacobuid/king-baseball -File .env
```

Use a separate King Baseball Clerk application when Baseball and Videos need separate user pools. All three Clerk keys must belong to the same instance; both publishable-key values must be identical. Development keys can be used for initial verification; complete Clerk's production setup before switching to live keys.

In GitHub Settings > Pages, select GitHub Actions as the build source. Commit and push the deployment fixes, then run **Provision infrastructure** before running **Web**. API and provisioning workflows share a concurrency group so they cannot update the Worker simultaneously.

Baseball uses Pulumi project `king-baseball`, stack `prod`; Worker `king-baseball-api`; D1 database `king-baseball-prod`; and bucket `jacobuid-king-baseball`. Do not point this project at the Videos Pulumi stack. Existing Backblaze runtime keys are retained during provisioning to avoid interrupting a running Worker if a later step fails; retire obsolete Baseball keys after verifying the new deployment.

If the repo is private, confirm your GitHub plan supports Pages for private repositories. After deployment, open `https://jacobuid.github.io/king-baseball/`, sign in with the Baseball Clerk application, and check that profile creation succeeds. An empty media library is expected until the starter is replaced with baseball features.

## Development

Copy the example environment files, run `npm ci`, then use `npm run dev:api` and `npm run dev:web`. Run `npm run check` before committing.
