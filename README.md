# King Bootstrap

Reusable private media streaming starter with React, Vite, Clerk, Cloudflare Workers, D1, Backblaze B2, Pulumi, GitHub Pages, and GitHub Actions.

## Create a project

1. Select **Use this template** on GitHub and create a repository.
2. Create Cloudflare, Clerk, Backblaze, and Pulumi accounts.
3. Add the repository secrets listed below.
4. Add the Clerk publishable key as the repository variable `VITE_CLERK_PUBLISHABLE_KEY`.
5. Run the **Provision infrastructure** workflow.
6. Set `VITE_API_URL` to the Worker URL printed by that workflow.
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

## Development

Copy the example environment files, run `npm ci`, then use `npm run dev:api` and `npm run dev:web`. Run `npm run check` before committing.
