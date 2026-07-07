# Driftless

A team task-tracking and daily-standup app. Members log tasks, plan their day, and
run async standups; managers get productivity insights across teams.

Built with **Next.js 16 (App Router)**, **React 19**, **Prisma 7 + PostgreSQL**,
**Auth.js (NextAuth v5)**, and **Tailwind CSS v4**. Realtime updates via **socket.io**.

## Features

- **Tasks & day planning** — daily tasks, work logs, a personal queue, and day plans
- **Async standups** — configurable daily cutoff, per-user standup entries
- **Teams & roles** — Admin / Manager / Member, team assignment, managed teams
- **Insights** — per-team productivity report (with opt-out per user)
- **Auth** — Microsoft Entra ID (Azure AD) SSO *and* email/password
- **Microsoft Teams integration** — optional daily prompts via Power Automate
  (see [`app/docs/teams-integration.md`](app/docs/teams-integration.md))

## Quick start (Docker)

Requires Docker with Compose. Postgres, migrations, and the app all come up together.

```bash
git clone https://github.com/UtsavLDCE/Driftless.git
cd Driftless

# Compose reads these from a .env at the repo root:
cat > .env <<EOF
AUTH_SECRET=$(openssl rand -base64 32)
AUTH_URL=http://localhost:3000
EOF

docker compose up -d
```

App runs at http://localhost:3000. The `migrate` service applies the Prisma schema
before the app starts. Postgres data persists in the `pgdata` volume.

## Quick start (manual)

Requires **Node.js 20+** and a running **PostgreSQL 14+**.

```bash
git clone https://github.com/UtsavLDCE/Driftless.git
cd Driftless/app

# 1. Database (run once) — role/db are named `tasktracker` by convention
psql -U postgres -c "CREATE USER tasktracker WITH PASSWORD 'tasktracker' CREATEDB;"
psql -U postgres -c "CREATE DATABASE tasktracker OWNER tasktracker;"

# 2. Environment
cp .env.example .env
# edit .env — at minimum set AUTH_SECRET (see below)

# 3. Install, migrate, run
npm install
npx prisma migrate deploy
npm run build
npm start        # or: npm run dev  (hot reload on :3000)
```

## Environment variables

Set in `app/.env` for manual runs, or the repo-root `.env` for Docker Compose.

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | yes (manual) | Postgres connection string. Preset in Compose. |
| `AUTH_SECRET` | **yes** | Session encryption key. Generate: `openssl rand -base64 32` |
| `AUTH_URL` | yes | Public app URL, e.g. `http://localhost:3000` or `http://<vm-ip>:3000` |
| `AUTH_TRUST_HOST` | yes | Set `"true"` behind a proxy / non-localhost host |
| `TEAMS_FLOW_URL` | no | Power Automate HTTP-trigger URL for Teams daily prompts |
| `TEAMS_SHARED_SECRET` | no | Bearer token shared with the Teams flow (`openssl rand -hex 32`) |

### Microsoft Entra ID (Azure AD) SSO — optional

For SSO login, register an app in Azure Portal → App Registrations:

1. Redirect URI: `<AUTH_URL>/api/auth/callback/microsoft-entra-id`
2. Copy the **Application (client) ID** and **Directory (tenant) ID**
3. Create a client secret and add the client/tenant/secret to `.env`

Email/password login works without this.

## First admin

After your first sign-in, promote yourself:

```bash
psql -U tasktracker -d tasktracker \
  -c "UPDATE \"User\" SET role = 'ADMIN' WHERE email = 'you@company.com';"
```

Then use the **Admin** panel (top nav) to create teams, assign users, set managers,
and configure the standup cutoff time.

## Project structure

```
.
├── docker-compose.yml   # postgres + migrate + app
├── SETUP.md             # detailed VM / production setup notes
└── app/                 # the Next.js application
    ├── src/app/         # App Router — (app) pages + /api routes
    ├── prisma/          # schema + migrations
    ├── docs/            # teams-integration.md
    └── Dockerfile       # multi-stage: builder / migrator / runner
```

## Production

Put a reverse proxy (nginx) in front of port 3000 for HTTPS, set `AUTH_URL` to the
real host, and add that URL as an Azure AD redirect URI. See [`SETUP.md`](SETUP.md)
for the full VM walkthrough.
