# Cadence MCP server

Exposes Cadence's day-planning tools to any MCP client (Claude Desktop, Cursor,
etc.). It wraps the running Next.js HTTP API, so every business rule — plan lock,
per-task hour cap, deferral justification — still applies.

## Setup

```bash
cd app/mcp && npm install
```

Auth uses your normal Cadence login. Set three env vars:

- `CADENCE_URL` — app base URL (default `http://localhost:3000`)
- `CADENCE_EMAIL`
- `CADENCE_PASSWORD`

The server logs in once via the credentials flow and reuses the session cookie
(re-logs in on a 401).

## Register with a client

Claude Desktop (`claude_desktop_config.json`) or any client that launches MCP
servers over stdio:

```json
{
  "mcpServers": {
    "cadence": {
      "command": "node",
      "args": ["/absolute/path/to/app/mcp/server.mjs"],
      "env": {
        "CADENCE_URL": "http://localhost:3000",
        "CADENCE_EMAIL": "you@example.com",
        "CADENCE_PASSWORD": "••••••"
      }
    }
  }
}
```

## Tools

Self: `list_tasks`, `create_task`, `update_task`, `delete_task`, `log_work`,
`list_queue`, `add_to_queue`, `promote_queue_item`, `get_day_plan`,
`set_day_plan`, `list_people`.

Manager/admin (plan others, see the team): `assign_task`, `assign_to_queue`,
`set_day_plan` (with `userId`), `team_tasks` (daily roll-up of what everyone is
working on).
