import { timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";
import type { TaskStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// ── Configuration ──────────────────────────────────────────────────────────
// Config is admin-editable and lives in AppSettings so it can be changed from the
// Admin → Integrations tab without an env edit or redeploy. Empty DB values fall
// back to the matching env var, so an env-only deployment keeps working.
//
//   flowUrl       — the Power Automate "When a HTTP request is received" trigger
//                   URL. The portal POSTs Adaptive Cards here; the Flow DMs each
//                   member and relays their reply back.
//   sharedSecret  — authenticates BOTH directions: the cron/Flow present it as
//                   `Authorization: Bearer <secret>` to /dispatch and /ingest, and
//                   the portal presents it to the Flow trigger.
//   enabled       — master switch the weekday dispatch (cron + "Send now") checks.
export type TeamsConfig = {
  enabled: boolean;
  flowUrl: string;
  sharedSecret: string;
};

export async function getTeamsConfig(): Promise<TeamsConfig> {
  const s = await prisma.appSettings.findUnique({
    where: { id: "singleton" },
    select: { teamsEnabled: true, teamsFlowUrl: true, teamsSharedSecret: true },
  });
  return {
    enabled: s?.teamsEnabled ?? false,
    flowUrl: (s?.teamsFlowUrl?.trim() || process.env.TEAMS_FLOW_URL || "").trim(),
    sharedSecret: (s?.teamsSharedSecret?.trim() || process.env.TEAMS_SHARED_SECRET || "").trim(),
  };
}

export function teamsConfigStatus(cfg: TeamsConfig): {
  enabled: boolean;
  flowUrl: boolean;
  secret: boolean;
} {
  return { enabled: cfg.enabled, flowUrl: cfg.flowUrl.length > 0, secret: cfg.sharedSecret.length > 0 };
}

// Constant-time bearer-token check against the shared secret. Returns false when
// the secret is unset so an unconfigured deployment can't be driven by an empty
// token.
export function authorizeTeamsRequest(req: NextRequest, secret: string): boolean {
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── Outbound: post a card to the Power Automate flow ───────────────────────
export type FlowEnvelope = {
  phase: "morning" | "eod";
  email: string;
  name: string | null;
  date: string; // YYYY-MM-DD (the portal calendar day)
  card: unknown; // Adaptive Card payload
};

export async function postToFlow(
  payload: FlowEnvelope,
  cfg: Pick<TeamsConfig, "flowUrl" | "sharedSecret">,
): Promise<{ ok: boolean; status: number; error?: string }> {
  if (!cfg.flowUrl) return { ok: false, status: 0, error: "Teams flow URL not set" };
  try {
    const res = await fetch(cfg.flowUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.sharedSecret}`,
      },
      body: JSON.stringify(payload),
    });
    return { ok: res.ok, status: res.status, error: res.ok ? undefined : await safeText(res) };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : "fetch failed" };
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "";
  }
}

// ── Adaptive Cards ─────────────────────────────────────────────────────────
// Adaptive Card 1.4 — supported by Teams and by Power Automate's
// "Post adaptive card and wait for a response" action. The Action.Submit data
// (including `phase`) is what the Flow forwards to /ingest.

export function buildMorningCard(opts: { name: string | null; dateLabel: string }): unknown {
  return {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.4",
    body: [
      { type: "TextBlock", size: "Large", weight: "Bolder", text: "Plan your day" },
      { type: "TextBlock", isSubtle: true, spacing: "None", text: opts.dateLabel },
      {
        type: "TextBlock",
        wrap: true,
        text: `Hi ${opts.name ?? "there"} — what's your goal for today and what are you working on?`,
      },
      {
        type: "Input.Text",
        id: "goal",
        label: "Goal of the day",
        isMultiline: true,
        placeholder: "The one outcome that matters most today",
      },
      {
        type: "Input.Text",
        id: "tasksText",
        label: "Today's tasks (one per line)",
        isMultiline: true,
        placeholder: "Fix login bug | 2\nReview PR #214 | 1.5\nWrite release notes | 1",
      },
      {
        type: "TextBlock",
        isSubtle: true,
        wrap: true,
        spacing: "None",
        text: "Format each line as: Task title | hours. Submitting locks today's plan.",
      },
    ],
    actions: [{ type: "Action.Submit", title: "Submit plan", data: { phase: "morning" } }],
  };
}

export type EodCardTask = {
  id: string;
  title: string;
  status: TaskStatus;
  estimatedHours: number | null;
};

const STATUS_CHOICES = [
  { title: "To Do", value: "TODO" },
  { title: "In Progress", value: "IN_PROGRESS" },
  { title: "Hold", value: "HOLD" },
  { title: "Done", value: "DONE" },
];

export function buildEodCard(opts: {
  name: string | null;
  dateLabel: string;
  tasks: EodCardTask[];
}): unknown {
  const taskBlocks = opts.tasks.flatMap((t) => [
    {
      type: "TextBlock",
      wrap: true,
      weight: "Bolder",
      separator: true,
      text: t.estimatedHours != null ? `${t.title}  ·  est ${t.estimatedHours}h` : t.title,
    },
    {
      type: "Input.ChoiceSet",
      id: `status_${t.id}`,
      label: "Status",
      value: t.status,
      choices: STATUS_CHOICES,
    },
    {
      type: "Input.Number",
      id: `actual_${t.id}`,
      label: "Actual hours (optional)",
      min: 0,
    },
  ]);

  return {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.4",
    body: [
      { type: "TextBlock", size: "Large", weight: "Bolder", text: "Wrap up your day" },
      { type: "TextBlock", isSubtle: true, spacing: "None", text: opts.dateLabel },
      opts.tasks.length === 0
        ? { type: "TextBlock", wrap: true, text: "No tasks were planned for today." }
        : {
            type: "TextBlock",
            wrap: true,
            text: `Hi ${opts.name ?? "there"} — how did today go? Update each task's status.`,
          },
      ...taskBlocks,
    ],
    actions:
      opts.tasks.length === 0
        ? []
        : [{ type: "Action.Submit", title: "Save status", data: { phase: "eod" } }],
  };
}

// ── Inbound: parse a member's reply forwarded from Power Automate ───────────
// Both shapes are accepted so the Flow can forward the raw Adaptive Card submit
// data as-is, or restructure it first — whichever is simpler to build there.

export type MorningTask = { title: string; estimatedHours: number };

// Accepts either a structured `tasks: [{title, estimatedHours}]` array or a
// free-text `tasksText` block with one "Title | hours" line per task.
export function parseMorningTasks(body: Record<string, unknown>): MorningTask[] {
  const out: MorningTask[] = [];

  if (Array.isArray(body.tasks)) {
    for (const raw of body.tasks) {
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;
      const title = typeof r.title === "string" ? r.title.trim() : "";
      const hours = toHours(r.estimatedHours);
      if (title && hours != null) out.push({ title, estimatedHours: hours });
    }
    return out;
  }

  if (typeof body.tasksText === "string") {
    for (const line of body.tasksText.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const [titlePart, hoursPart] = trimmed.split("|");
      const title = (titlePart ?? "").trim();
      const hours = toHours((hoursPart ?? "").replace(/h\s*$/i, "").trim());
      if (title && hours != null) out.push({ title, estimatedHours: hours });
    }
  }

  return out;
}

export type EodUpdate = {
  taskId: string;
  status?: TaskStatus;
  actualHours?: number | null;
  notes?: string | null;
};

const VALID_STATUSES: readonly string[] = ["TODO", "IN_PROGRESS", "HOLD", "DONE"];

// Accepts either a structured `statuses: [{taskId, status, actualHours, notes}]`
// array, or the flat Adaptive Card submit map with `status_<id>` / `actual_<id>`
// / `notes_<id>` keys.
export function parseEodUpdates(body: Record<string, unknown>): EodUpdate[] {
  if (Array.isArray(body.statuses)) {
    const out: EodUpdate[] = [];
    for (const raw of body.statuses) {
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;
      const taskId = typeof r.taskId === "string" ? r.taskId : "";
      if (!taskId) continue;
      out.push({
        taskId,
        status: normalizeStatus(r.status),
        actualHours: toHours(r.actualHours),
        notes: typeof r.notes === "string" && r.notes.trim() ? r.notes.trim().slice(0, 2000) : undefined,
      });
    }
    return out;
  }

  const byId = new Map<string, EodUpdate>();
  const ensure = (id: string) => {
    let u = byId.get(id);
    if (!u) {
      u = { taskId: id };
      byId.set(id, u);
    }
    return u;
  };
  for (const [key, value] of Object.entries(body)) {
    let m: RegExpExecArray | null;
    if ((m = /^status_(.+)$/.exec(key))) {
      const s = normalizeStatus(value);
      if (s) ensure(m[1]).status = s;
    } else if ((m = /^actual_(.+)$/.exec(key))) {
      ensure(m[1]).actualHours = toHours(value);
    } else if ((m = /^notes_(.+)$/.exec(key))) {
      if (typeof value === "string" && value.trim()) ensure(m[1]).notes = value.trim().slice(0, 2000);
    }
  }
  return [...byId.values()];
}

function normalizeStatus(value: unknown): TaskStatus | undefined {
  return typeof value === "string" && VALID_STATUSES.includes(value) ? (value as TaskStatus) : undefined;
}

function toHours(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}
