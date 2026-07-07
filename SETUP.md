# Driftless — Setup Guide

## Prerequisites
- Node.js 20+
- PostgreSQL 14+
- Azure AD app registration (for Microsoft SSO)

## Azure AD Setup (Required for Login)

1. Go to Azure Portal > Azure Active Directory > App Registrations > New Registration
2. Name: "Driftless"
3. Redirect URI: `http://<your-vm-ip>:3000/api/auth/callback/microsoft-entra-id`
4. After creating, note the **Application (client) ID** and **Directory (tenant) ID**
5. Certificates & secrets > New client secret → copy the value immediately

## Local / VM Setup

> **Note:** The Postgres role/database are named `tasktracker` throughout this guide.
> These identifiers are deliberately left unchanged during the Driftless rebrand —
> they are internal infrastructure names (not user-visible) and renaming them would
> require re-provisioning the database and rewriting `DATABASE_URL`.

```bash
# 1. Set up the database (run once)
psql -U postgres -c "CREATE USER tasktracker WITH PASSWORD 'tasktracker' CREATEDB;"
psql -U postgres -c "CREATE DATABASE tasktracker OWNER tasktracker;"

# 2. Configure environment
cd app
cp .env.example .env
# Edit .env and fill in Azure AD credentials + NEXTAUTH_URL (your VM IP)

# 3. Generate NEXTAUTH_SECRET
openssl rand -base64 32  # paste this into NEXTAUTH_SECRET in .env

# 4. Install dependencies
npm install

# 5. Run database migrations
npx prisma migrate deploy

# 6. Start the app
npm run build
npm start
```

## First User / Admin Setup

After signing in for the first time, promote yourself to Admin:

```bash
psql -U tasktracker -d tasktracker -c \
  "UPDATE \"User\" SET role = 'ADMIN' WHERE email = 'your.email@company.com';"
```

Then use the Admin panel (top nav) to:
- Create teams
- Assign users to teams
- Set manager roles
- Configure standup cutoff time

## Docker Compose (if Docker is available)

```bash
# From the repo root
cp app/.env.example app/.env
# Edit .env, then:
docker compose up -d
```

## Production Notes

- Set `NEXTAUTH_URL` to your actual VM address, e.g. `http://192.168.1.100:3000`
- Add the same URL as a Redirect URI in Azure AD app registration
- Use a reverse proxy (nginx) in front of port 3000 for HTTPS
