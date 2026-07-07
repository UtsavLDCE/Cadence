#!/usr/bin/env bash
# Trigger a Microsoft Teams daily prompt dispatch.
#
# Usage:  teams-cron.sh morning|eod
#
# Reads:
#   APP_URL              base portal URL (default http://localhost:3000)
#   TEAMS_SHARED_SECRET  bearer token the /dispatch endpoint expects (required)
#
# Wire it to the weekday schedule with crontab — see teams-crontab.example.
# Idempotent: the endpoint skips anyone already prompted for that phase today,
# so a missed run that fires late (or a retry) won't double-post.
set -euo pipefail

PHASE="${1:-}"
if [[ "$PHASE" != "morning" && "$PHASE" != "eod" ]]; then
  echo "usage: $0 morning|eod" >&2
  exit 2
fi

APP_URL="${APP_URL:-http://localhost:3000}"
if [[ -z "${TEAMS_SHARED_SECRET:-}" ]]; then
  echo "TEAMS_SHARED_SECRET is not set" >&2
  exit 1
fi

curl -fsS -X POST \
  -H "Authorization: Bearer ${TEAMS_SHARED_SECRET}" \
  "${APP_URL}/api/integrations/teams/dispatch?phase=${PHASE}"
echo
