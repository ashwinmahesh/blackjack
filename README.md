# Dealer's Edge

A mobile-first, four-deck blackjack game built with Next.js. The app uses practice tokens only and supports persistent device-local balances, four table-stakes tiers, hit, stand, double, one equal-value split per hand (including mixed 10/J/Q/K pairs), late surrender, and Perfect Pairs, 21+3, and Match the Dealer side bets.

## Run locally

Requires Node.js 22 or newer.

```bash
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Production image

The multi-stage image contains the standalone Next.js server, the frontend assets, and API routes in one small runtime image. It listens on `0.0.0.0` and honors Cloud Run's `PORT` variable (default `8080`).

```bash
npm run docker:build
npm run docker:run
```

Check the app at [http://localhost:8080](http://localhost:8080) and the backend health endpoint at [http://localhost:8080/api/health](http://localhost:8080/api/health).

You can also set a custom image name directly:

```bash
docker build -t blackjack-web:latest .
docker run --rm -p 8080:8080 -e PORT=8080 blackjack-web:latest
```

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

## Architecture

Solo game state is device-local and resets when the page reloads. The same container now includes the first server-authoritative multiplayer layer:

- `POST /api/rooms` creates a protected five-seat room and a server-owned four-deck shoe.
- `POST /api/rooms/:code/join` validates the passcode and assigns a private player session token.
- `GET /api/rooms/:code` returns safe room state without passcodes, session tokens, or shoe order.
- `POST /api/rooms/:code/ready` updates a player seat using its private session token.
- `POST /api/rooms/:code/start` lets a ready host open the shared betting round.
- `POST /api/rooms/:code/action` handles authoritative bets, hit, stand, double, split, surrender, settlement, and next-round actions.

The private-room UI polls safe room state and keeps dealer hole cards and shoe order server-side. The development room store is process-local, expires rooms after six hours, and is suitable for testing on one server instance. Before scaling Cloud Run above one instance, replace the store behind `lib/server/rooms.ts` with Firestore or another shared transactional store. Cloud Run instances are stateless and in-memory rooms are not shared across instances.
