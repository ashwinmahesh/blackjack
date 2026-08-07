# Dealer's Edge

A mobile-first, six-deck blackjack game built with Next.js. The app uses practice tokens only and supports persistent device-local balances, four table-stakes tiers, hit, stand, double, up to five split hands per round (including mixed 10/J/Q/K pairs), late surrender, and Perfect Pairs, 21+3, and Match the Dealer side bets.

## Quick start

Requires Node.js 22 or newer.

Install dependencies and start the development server:

```bash
npm ci && npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Stop the server with `Ctrl+C`.

## Run the production build locally

Build and start the same Next.js server used by the container:

```bash
npm ci
npm run build
npm start -- -H 0.0.0.0 -p 8081
```

Open [http://localhost:8081](http://localhost:8081). Check backend health at [http://localhost:8081/api/health](http://localhost:8081/api/health).

## Validate changes

```bash
npm run lint && npm run build
```

## Production image

The multi-stage image contains the standalone Next.js server, the frontend assets, and API routes in one small runtime image. It listens on `0.0.0.0` and honors Cloud Run's `PORT` variable (default `8080`).

```bash
npm run docker:build && npm run docker:run
```

Check the app at [http://localhost:8080](http://localhost:8080) and the backend health endpoint at [http://localhost:8080/api/health](http://localhost:8080/api/health).

You can also set a custom image name directly:

```bash
docker build -t blackjack-web:latest .
docker run --rm -p 8080:8080 -e PORT=8080 blackjack-web:latest
```

## Google Analytics

Google Analytics 4 is enabled with the site's `G-RMTSSXD4LY` measurement ID. No runtime environment variable is required. After deployment, open the site and check the Google Analytics Realtime report to confirm events are arriving.

## Deploy to Google Cloud Run

Set these values for your Google Cloud project and Artifact Registry repository:

```bash
PROJECT_ID="your-project-id"
REGION="us-central1"
REPOSITORY="web-apps"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/dealers-edge:latest"
```

Build with Cloud Build, push to Artifact Registry, and deploy the same image:

```bash
gcloud builds submit --project "$PROJECT_ID" --tag "$IMAGE" .
gcloud run deploy dealers-edge \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --image "$IMAGE" \
  --port 8080 \
  --allow-unauthenticated
```

For a private service, omit `--allow-unauthenticated`. Configure the Cloud Run startup probe path as `/api/health` if you want an HTTP probe in addition to Cloud Run's default TCP startup check.

### GitHub Actions deployment

The workflow at `.github/workflows/deploy-cloud-run.yml` runs on pushes to `main` and can also be started manually from the Actions tab. It authenticates without a service-account key, builds and pushes commit-specific and `latest` image tags to Artifact Registry, then deploys the commit-specific image to Cloud Run.

Create these GitHub repository **Actions variables** under **Settings → Secrets and variables → Actions → Variables**:

| Variable | Example | Purpose |
| --- | --- | --- |
| `GCP_PROJECT_ID` | `your-project-id` | Google Cloud project ID |
| `GCP_REGION` | `us-central1` | Artifact Registry and Cloud Run region |
| `GAR_REPOSITORY` | `web-apps` | Existing Artifact Registry Docker repository |
| `IMAGE_NAME` | `dealers-edge` | Container image name |
| `CLOUD_RUN_SERVICE` | `dealers-edge` | Cloud Run service to create or update |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | `projects/123456789/locations/global/workloadIdentityPools/github/providers/blackjack` | Full Workload Identity provider resource name; it uses the numeric project number |
| `GCP_SERVICE_ACCOUNT` | `github-deploy@your-project-id.iam.gserviceaccount.com` | Service account impersonated by GitHub Actions |
| `CLOUD_RUN_MAX_INSTANCES` | `1` | Optional; defaults to `1` while multiplayer rooms use process-local memory |

The service account needs permission to push images and deploy the service, typically `roles/artifactregistry.writer` and `roles/run.admin`, plus permission to act as the Cloud Run runtime service account when required. Configure the Workload Identity provider to trust only this GitHub repository, and grant its repository principal `roles/iam.workloadIdentityUser` on `GCP_SERVICE_ACCOUNT`.

The Artifact Registry repository must exist before the first run. The workflow intentionally deploys the SHA-tagged image rather than `latest`, so each Cloud Run revision points to the exact image built by that workflow run.

## Architecture

The token balance is persisted in browser storage, while an unfinished solo round resets when the page reloads. The same container includes the server-authoritative multiplayer layer:

- `POST /api/rooms` creates a protected five-seat room and a server-owned six-deck shoe.
- `POST /api/rooms/:code/join` validates the passcode and assigns a private player session token.
- `GET /api/rooms/:code` returns safe room state without passcodes, session tokens, or shoe order.
- `POST /api/rooms/:code/ready` updates a player seat using its private session token.
- `POST /api/rooms/:code/start` lets a ready host open the shared betting round.
- `POST /api/rooms/:code/action` handles authoritative bets, hit, stand, double, split, surrender, settlement, and next-round actions.

The private-room UI polls safe room state and keeps dealer hole cards and shoe order server-side. The development room store is process-local, expires rooms after six hours, and is suitable for testing on one server instance. Before scaling Cloud Run above one instance, replace the store behind `lib/server/rooms.ts` with Firestore or another shared transactional store. Cloud Run instances are stateless and in-memory rooms are not shared across instances.
