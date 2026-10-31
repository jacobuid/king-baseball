# King Baseball

Baseball application foundation using React, Vite, Clerk, Cloudflare Workers, D1, Backblaze B2, Pulumi, GitHub Pages, and GitHub Actions. The React Team screen saves teams and players to the authenticated Cloudflare API and D1 database. Existing walk-up song editing and audio previews remain device-local; no music schema or music API is implemented. Legacy media-library API routes remain available.

## Team and player data

- Each Clerk account owns one team, matching the current single-team screen. Ownership comes from the verified session, never from a request field.
- `teams` stores the team ID, owner, name, version, timestamps, and a mutation identifier used for safe concurrent saves.
- `players` stores stable player IDs, team IDs, names, and zero-based roster order. There are no music fields.
- `GET /api/team` returns `{ "team": null }` for a new account, otherwise the saved team and ordered players.
- `PUT /api/team` accepts `{ "name": "Sluggers", "version": 0, "players": [{ "id": "<UUID>", "name": "Alex" }] }`. Use version `0` to create, or the returned version to update. The complete roster is saved atomically, including player removal and reordering. IDs are preserved across saves.
- Team names allow 1–48 characters and player names 1–55. Each roster requires 1–100 players; duplicate IDs or normalized names are rejected. Stale saves return `409` without changing the roster.
- Existing IndexedDB rosters load as drafts only when the account has no server team. Save Team uploads names and roster order, excluding music. A failed server load blocks saving until Retry succeeds, preventing accidental replacement of existing data.

The API workflow applies `0002_teams.sql` before deploying the API. Deploy the API successfully before using the new frontend. No new credentials or repository variables are required.

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

If the repo is private, confirm your GitHub plan supports Pages for private repositories. After deployment, open `https://jacobuid.github.io/king-baseball/`, sign in with the Baseball Clerk application, create a team with players, save, and reload to confirm that the roster persists.

## Development

Copy the example environment files, run `npm ci`, then use `npm run dev:api` and `npm run dev:web`. Run `npm run check` before committing.
