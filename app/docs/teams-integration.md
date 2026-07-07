# Microsoft Teams daily prompts

The portal drives a weekday loop with each member over Microsoft Teams:

- **Morning** — an Adaptive Card asks for the day's **goal** and the day's **tasks with hour estimates**. Submitting writes a `DayPlan` (goal), creates the `DailyTask` rows, and **locks** the plan — exactly as if the member had hit *Submit plan* in the app.
- **End of day** — a card lists the day's tasks and asks for **status** (and optional actual hours). The replies update those tasks.

Members are matched to portal users **by email** (their Teams sign-in email must equal their portal email).

## Architecture

```
            weekday cron                      Power Automate flow
  (crontab) ───────────────▶  /dispatch  ───────────────▶  posts Adaptive Card
                              (this app)   POST card JSON    to member in Teams,
                                                             waits for their reply
                                                                     │
  portal DB  ◀───────────────  /ingest   ◀──────────────────────────┘
  (DayPlan,                   (this app)   POST reply JSON
   DailyTask)
```

Only **one** Power Automate flow is needed (no Azure Bot, no hosting). The portal owns the card content; the flow just relays. The flow DMs **each member individually** (per-person DM), matched by email.

## 1. Configuration (Admin → Integrations)

Configure everything from the portal UI — no redeploy, no env edit:

1. Sign in as an **ADMIN** and open **Admin → Integrations**.
2. Paste the **Power Automate flow URL** (step 2 below).
3. Click **Generate** for a **shared secret** (or paste your own), then **Save settings**.
4. Tick **Enable weekday Teams prompts**.
5. Click **Send test DM to myself** to confirm the flow + secret + email mapping work before turning the team loop on.

| Field | Purpose |
|---|---|
| Power Automate flow URL | The flow's **"When a HTTP request is received"** trigger URL. The portal POSTs cards here. |
| Shared secret | A long random string. Authenticates cron→`/dispatch`, flow→`/ingest`, and portal→flow. Use the **same value** in the flow's auth check and in the crontab (`TEAMS_SHARED_SECRET`). |
| Enable weekday Teams prompts | Master switch the dispatch (cron + "Send now") checks. |

These persist in `AppSettings`. If a field is left blank, the portal falls back to the matching env var (`TEAMS_FLOW_URL` / `TEAMS_SHARED_SECRET`) — handy for fully-automated deploys. The secret is never returned to the browser once saved; re-save only when you want to rotate it.

## 2. Power Automate flow

Create a flow with these steps:

1. **Trigger: When a HTTP request is received.** Copy the generated URL into `TEAMS_FLOW_URL`. Optionally verify the incoming `Authorization: Bearer` header equals your secret.
   The request body the portal sends is:
   ```json
   { "phase": "morning|eod", "email": "user@co.com", "name": "User", "date": "2026-06-29", "card": { /* Adaptive Card */ } }
   ```
2. **Action: Post adaptive card and wait for a response** (Teams connector). Recipient = `email` from the trigger. Message = the `card` object from the trigger.
3. **Action: HTTP — POST** back to the portal `/api/integrations/teams/ingest`:
   - Header `Authorization: Bearer <TEAMS_SHARED_SECRET>`
   - Body: merge `email` and `phase` from the trigger with the card's submit data, e.g.
     ```json
     { "phase": "morning", "email": "user@co.com", "goal": "...", "tasksText": "Fix bug | 2\nReview PR | 1" }
     ```
     For EOD, forward the submit data as-is — it contains `status_<taskId>` / `actual_<taskId>` keys, which `/ingest` parses. (A `statuses: [{taskId,status,actualHours,notes}]` array is also accepted if you'd rather restructure it in the flow.)

## 3. Weekday cron

The portal exposes the dispatch endpoint; a host cron triggers it Mon–Fri.

```
POST /api/integrations/teams/dispatch?phase=morning   # builds + sends morning cards
POST /api/integrations/teams/dispatch?phase=eod        # builds + sends EOD cards
```

Use `scripts/teams-cron.sh` + `scripts/teams-crontab.example`:

```bash
# edit paths/times, then:
crontab scripts/teams-crontab.example
```

The `1-5` day-of-week field is the "5 days" (Mon–Fri) window. Dispatch is **idempotent** per member/day/phase, so a retry or a late run never double-posts.

## 4. Endpoints reference

| Endpoint | Auth | Notes |
|---|---|---|
| `POST /dispatch?phase=morning\|eod` | Bearer secret **or** ADMIN session | Sends cards to all members; skips anyone already prompted for that phase today. Returns 503 if the integration is disabled or has no flow URL. |
| `POST /ingest` | Bearer secret | Writes a member's reply. Morning is idempotent (won't duplicate tasks); EOD is safe to re-apply. |
| `POST /test` | ADMIN session | Sends one card to the admin's own Teams DM. Doesn't record a prompt or require the loop to be enabled — a config smoke test. |

The admin panel's **Integrations** tab is the control surface: edit the flow URL / secret / enable toggle, send a test DM, watch per-member send/reply state for today, and trigger *Send now*. The *Send now* and *Test* buttons use the admin session, so the secret never reaches the browser.
