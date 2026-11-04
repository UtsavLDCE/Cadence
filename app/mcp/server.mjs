#!/usr/bin/env node
// Cadence MCP server. Exposes the app's day-planning tools to any MCP client
// (Claude Desktop, Cursor, …) by wrapping the existing Next.js HTTP API — so all
// business rules (plan lock, hour caps, deferral justification) still apply.
//
// Auth: logs in once with CADENCE_EMAIL/CADENCE_PASSWORD via the next-auth
// credentials flow and reuses the session cookie. Re-logs in on a 401.
//
// Env: CADENCE_URL (default http://localhost:3000), CADENCE_EMAIL, CADENCE_PASSWORD.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE = (process.env.CADENCE_URL || "http://localhost:3000").replace(/\/$/, "");
const EMAIL = process.env.CADENCE_EMAIL;
const PASSWORD = process.env.CADENCE_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error("Set CADENCE_EMAIL and CADENCE_PASSWORD env vars.");
  process.exit(1);
}

// --- cookie jar: forward whatever next-auth sets (csrf + session token) ---
const jar = new Map();
function storeCookies(res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}
const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");

async function login() {
  jar.clear();
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  storeCookies(csrfRes);
  const { csrfToken } = await csrfRes.json();
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader() },
    body: new URLSearchParams({ csrfToken, email: EMAIL, password: PASSWORD, callbackUrl: BASE }),
    redirect: "manual",
  });
  storeCookies(res);
  if (!jar.has("authjs.session-token") && !jar.has("__Secure-authjs.session-token")) {
    throw new Error("Login failed — check CADENCE_EMAIL / CADENCE_PASSWORD.");
  }
}

// Call the app API. One transparent re-login retry on 401 (cold start / expiry).
async function api(path, { method = "GET", body } = {}, retry = true) {
  if (jar.size === 0) await login();
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { cookie: cookieHeader(), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && retry) {
    await login();
    return api(path, { method, body }, false);
  }
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = data && typeof data === "object" && data.error ? data.error : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

const ok = (data) => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });

const server = new McpServer({ name: "cadence", version: "0.1.0" });

function tool(name, description, shape, run) {
  server.registerTool(name, { description, inputSchema: shape }, async (args) => {
    try { return ok(await run(args)); }
    catch (e) { return { isError: true, content: [{ type: "text", text: String(e.message || e) }] }; }
  });
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("YYYY-MM-DD");
const priority = z.enum(["HIGH", "MEDIUM", "LOW"]);
const status = z.enum(["TODO", "IN_PROGRESS", "HOLD", "DONE", "NOT_WORKED"]);

tool("list_tasks", "List tasks for a day (default today). scope=overdue returns open tasks before today. Managers may pass userId.",
  { date: date.optional(), scope: z.enum(["overdue"]).optional(), userId: z.string().optional() },
  (a) => {
    const q = new URLSearchParams();
    if (a.date) q.set("date", a.date);
    if (a.scope) q.set("scope", a.scope);
    if (a.userId) q.set("userId", a.userId);
    const qs = q.toString();
    return api(`/tasks${qs ? `?${qs}` : ""}`);
  });

tool("create_task", "Create a task for today. Planned tasks need estimatedHours. Set status=DONE to log already-done work (estimate optional, may backdate with date).",
  {
    title: z.string(),
    estimatedHours: z.number().positive().optional(),
    status: status.optional(),
    workType: z.enum(["FOCUS", "INTERRUPTION"]).optional(),
    priority: priority.optional(),
    categoryId: z.string().optional(),
    notes: z.string().optional(),
    unplanned: z.boolean().optional(),
    actualHours: z.number().nonnegative().optional(),
    date: date.optional(),
  },
  (a) => api("/tasks", { method: "POST", body: a }));

tool("update_task", "Update a task: change status, effort, notes, priority, move to a future day, or complete a past task (status=DONE + completedDate). Deferring a locked task needs deferralCause.",
  {
    id: z.string(),
    title: z.string().optional(),
    status: status.optional(),
    estimatedHours: z.number().positive().optional(),
    actualHours: z.number().nonnegative().optional(),
    notes: z.string().optional(),
    priority: priority.optional(),
    date: date.optional().describe("move to a future day"),
    completedDate: date.optional().describe("retroactively complete on this day"),
    deferralCause: z.enum(["INTERRUPTED", "UNDERESTIMATED", "BLOCKED", "DEPRIORITIZED", "OTHER"]).optional(),
    deferralNote: z.string().optional(),
  },
  ({ id, ...body }) => api(`/tasks/${id}`, { method: "PATCH", body }));

tool("delete_task", "Delete a task by id.", { id: z.string() },
  ({ id }) => api(`/tasks/${id}`, { method: "DELETE" }));

tool("log_work", "Append dated effort to a task (re-sums actualHours). date defaults to today, backdatable.",
  { taskId: z.string(), hours: z.number().positive().max(24), note: z.string().optional(), date: date.optional() },
  ({ taskId, ...body }) => api(`/tasks/${taskId}/worklog`, { method: "POST", body }));

tool("list_queue", "List the caller's personal backlog (future work), ordered by position.", {},
  () => api("/queue"));

tool("add_to_queue", "Add an item to the backlog (needs an effort estimate).",
  { title: z.string(), estimatedHours: z.number().positive(), notes: z.string().optional(), priority: priority.optional() },
  (a) => api("/queue", { method: "POST", body: a }));

tool("promote_queue_item", "Move a backlog item into today's plan as a task.", { id: z.string() },
  ({ id }) => api(`/queue/${id}/promote`, { method: "POST" }));

tool("get_day_plan", "Get today's plan: goal + submission (lock) state.", {},
  () => api("/day-plan"));

tool("set_day_plan", "Set a day's goal and/or submit (lock) it. Self: today only, submit allowed. Manager: pass userId (+ optional date) to set a member's goal (no submit).",
  { goal: z.string().optional(), submit: z.boolean().optional(), userId: z.string().optional(), date: date.optional() },
  (a) => api("/day-plan", { method: "PATCH", body: a }));

tool("list_people", "Roster of other users (id, name, email) — for blockers/assignments.", {},
  () => api("/people"));

// --- manager: plan other people's days ---
tool("assign_task", "Manager/admin: drop a task onto a member's day (default today). Bypasses their plan lock. estimatedHours optional.",
  {
    userId: z.string(),
    title: z.string(),
    date: date.optional(),
    priority: priority.optional(),
    estimatedHours: z.number().positive().optional(),
    categoryId: z.string().optional(),
    notes: z.string().optional(),
  },
  (a) => api("/manager/tasks", { method: "POST", body: a }));

tool("assign_to_queue", "Manager/admin: add a task to a member's backlog. estimatedHours optional (member sets before promoting).",
  {
    userId: z.string(),
    title: z.string(),
    priority: priority.optional(),
    estimatedHours: z.number().positive().optional(),
    notes: z.string().optional(),
  },
  (a) => api("/manager/queue", { method: "POST", body: a }));

tool("team_tasks", "Manager/admin: what everyone is working on for a day (default today). Rolls up each person's tasks. Pass userIds to limit to specific people.",
  { date: date.optional(), userIds: z.array(z.string()).optional() },
  async ({ date: d, userIds }) => {
    const people = await api("/people");
    const targets = userIds ? people.filter((p) => userIds.includes(p.id)) : people;
    const qs = d ? `&date=${d}` : "";
    return Promise.all(targets.map(async (p) => ({
      user: { id: p.id, name: p.name, email: p.email },
      tasks: await api(`/tasks?userId=${p.id}${qs}`).catch((e) => ({ error: String(e.message || e) })),
    })));
  });

await server.connect(new StdioServerTransport());
