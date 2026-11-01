# KingSports music

React search drawer → authenticated Cloudflare API → Google Cloud Run (FastAPI,
yt-dlp, FFmpeg) → Cloud Tasks → private B2 `music/` prefix. D1 tracks job states,
account ownership, and ordered assignments. Cloud Tasks keeps each conversion
inside a billed HTTP request, rather than an unreliable background thread after
the response. Closing the drawer does not cancel the import.

AAC audio is copied into an M4A container with fast-start metadata. Other source
codecs are converted to AAC for iPhone/Android/browser compatibility. No MP3 is
required. Limits: 20-minute source, 50 MB audio, 100 imports/day, 500 library
entries/account. Search debounces 1.6 seconds and returns eight results; it uses
yt-dlp search rather than the YouTube Data API, so no YouTube API key is required.
Source availability from Google's network must be tested after deployment.

Team playlists contain full tracks, ordered independently of player assignments.
Player clip start/duration controls are intentionally deferred. Music assignment
buttons save immediately to the account; roster changes still use Save Team.
Existing local audio remains playable until a cloud song replaces it. No offline
download/cache is implemented in this update. Playback uses a one-hour signed
Worker link, authenticates B2 server-side, forwards byte ranges, and uses
`private, no-store`, following the King Videos playback pattern.

## First deployment

Install the Google Cloud CLI and run `gcloud auth login` with the account that
owns the billing-linked project. GitHub CLI must also be signed in (`gh auth login`).
Run from the repository root in PowerShell:

```powershell
$env:GCP_PROJECT_ID = 'project-f398dc10-2417-49db-aa6'
$env:API_ORIGIN = 'https://king-sports-api.jacobuid-king-videos.workers.dev'
gcloud projects update $env:GCP_PROJECT_ID --name=KingSports
npm.cmd run deploy:music
```

The script reads existing B2 bootstrap and Cloudflare credentials from local
`.env` (never prints them), enables required APIs, creates a dedicated runtime
service account, a rate-limited Cloud Tasks queue, and a Secret Manager token.
It builds the Dockerfile remotely, deploys Cloud Run at min=0/max=1,
1 CPU/1 GiB, creates a B2 key restricted to `music/`, and installs only the
new music secrets in the existing Worker. It also saves the token/service URL
as GitHub secrets for future infrastructure provisioning. Run it again to update
the service; it preserves the token and existing B2 keys.

The Cloud Run HTTP endpoint is public at the network level because both the
Worker and Cloud Tasks reach it; every route requires the private service token.
No browser receives that token or B2 credentials. Source deployment requires
permission to enable services, manage service accounts/roles/secrets, build, and
deploy Cloud Run. Owner on this personal project covers the initial setup.
Project billing must be enabled. Small storage/build/secret charges remain
possible even within Cloud Run's compute allowance.

Commit/push the app/API changes and wait for API migrations and Web deployment.
Run the music deployment script before trying imports. Nothing in the setup
script automatically pushes application code.

## Checks and operations

```powershell
npm.cmd run check
# With Python dependencies installed:
cd services/music
python -m unittest discover -s tests -v
```

The Music service checks workflow also builds the Linux container. No live
download test runs in CI. A deployment smoke test should search for an available
permitted source, import it, confirm ready, preview it, assign a player, and save
a separate team playlist. Confirm on both iPhone and Android. Rebuild the service
when yt-dlp extraction changes; builds install the latest compatible release.

Queue dispatch is limited to one import at a time, three attempts, with a
15-minute request deadline. Transient network/storage failures retry; source
failures expose a Retry button. Library reads recover jobs stale for over an
hour. Completed tasks are idempotent. Failed uploads can leave an unreferenced
object/version; no automatic library deletion or B2 version cleanup is included.
Cloud Run revisions can overlap during deployment, so max=1 is not a billing
hard cap. Future automatic deployments should use GitHub OIDC, not a downloaded
Google service-account key.
