# KingSports music

React search drawer → authenticated Cloudflare API → Google Cloud Run (FastAPI,
ytmusicapi, yt-dlp, FFmpeg) → Cloud Tasks → private B2 `music/` prefix. D1 tracks job states,
account ownership, and ordered assignments. Cloud Tasks keeps each conversion
inside a billed HTTP request, rather than an unreliable background thread after
the response. Closing the drawer does not cancel the import.

AAC audio is copied into an M4A container with fast-start metadata. Other source
codecs are converted to AAC for iPhone/Android/browser compatibility. No MP3 is
required. Limits: 20-minute source, 50 MB audio, 100 imports/day, 500 library
entries/account. Search debounces 1.6 seconds and returns eight results; it uses
anonymous ytmusicapi catalog search rather than the YouTube Data API, so no
YouTube API key or account session is required for search. Songs is the default
category; users can switch to Videos. Results include artist, album, artwork,
duration, and an explicit-content indicator when that metadata is available.
yt-dlp still performs downloads; ytmusicapi does not resolve download sign-in checks.
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

Before provisioning, the script requires a verified, active Cloud Run spend cap
of $1/month or less for this project. An alerts-only budget does not qualify.
Keep the existing $0 billing alert as an additional notification. The cap uses
gross estimated costs before credits/free allowances; it can pause imports even
when the actual bill remains zero. Enforcement is delayed and excludes supporting
services such as Artifact Registry and Cloud Build, so this is not an exact cap
on the entire Google bill. The script never lifts a cap that has been enforced.

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

### Optional YouTube authentication

The deployed service can search anonymously, but the live download test received
YouTube's sign-in/bot-verification response from Cloud Run. Cookies may help;
they do not guarantee access from Google's network.

Export only YouTube cookies as a Netscape-format `cookies.txt` file, following
[yt-dlp's guide](https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies).
Use a separate account if possible. Keep the file out of chat and GitHub.
In Google Secret Manager, create the secret `king-sports-youtube-cookies` and
use **Upload file** to add its value. Project: `project-f398dc10-2417-49db-aa6`.

The deployment script detects an enabled version without reading its contents,
grants the runtime account access to that secret, and mounts it at
`/secrets/youtube/cookies.txt`. Run the deployment script after adding the secret
to activate this optional support. No browser extraction is performed by the app.
Anonymous search stays unchanged; only download commands use the cookie file.
Each job makes its own private writable copy, filters out non-YouTube domains,
and removes the copy with the temporary working directory. Authenticated
command errors omit raw stderr so cookie parser errors cannot leak cookie rows.

Refresh expired cookies by uploading a new secret version. The mounted `latest`
version is read on each import. Disable older versions when no longer needed to
avoid accumulating active-version charges. To remove authentication entirely,
remove the Cloud Run secret mount and `YOUTUBE_COOKIES_FILE` environment setting.

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
