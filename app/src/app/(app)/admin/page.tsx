import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { bestMatch } from "@/lib/sprint";
import { AdminClient } from "./admin-client";

export default async function AdminPage() {
  const session = await auth();
  if (session!.user.role !== "ADMIN") redirect("/dashboard");

  // Engagement window: last 7 days. Day boundary in UTC (app default timezone).
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const [
    users,
    teams,
    settings,
    taskLast,
    taskCreated7,
    planLast,
    planSubmitted7,
    workLast,
    workHours7,
    statusLast,
  ] = await Promise.all([
    prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        teamId: true,
        managerId: true,
        excludedFromInsights: true,
        lastLoginAt: true,
        team: { select: { id: true, name: true } },
        manager: { select: { id: true, name: true, email: true } },
        tags: { select: { id: true, name: true } },
      },
      orderBy: [{ role: "asc" }, { name: "asc" }],
    }),
    prisma.team.findMany({
      include: {
        manager: { select: { id: true, name: true, email: true } },
        _count: { select: { members: true } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.appSettings.upsert({
      where: { id: "singleton" },
      update: {},
      create: { id: "singleton" },
    }),
    // Last-active is the max timestamp a user has produced across the activity
    // tables. JWT sessions aren't stored, so this is the honest proxy for
    // "currently active" — no login/heartbeat is tracked.
    prisma.dailyTask.groupBy({ by: ["userId"], _max: { updatedAt: true } }),
    prisma.dailyTask.groupBy({ by: ["userId"], where: { createdAt: { gte: weekAgo } }, _count: { _all: true } }),
    prisma.dayPlan.groupBy({ by: ["userId"], _max: { updatedAt: true } }),
    prisma.dayPlan.groupBy({ by: ["userId"], where: { submittedAt: { gte: weekAgo } }, _count: { _all: true } }),
    prisma.workLog.groupBy({ by: ["userId"], _max: { createdAt: true } }),
    prisma.workLog.groupBy({ by: ["userId"], where: { date: { gte: weekAgo } }, _sum: { hours: true } }),
    prisma.taskStatusEvent.groupBy({ by: ["userId"], _max: { at: true } }),
  ]);

  // Merge the per-source aggregates into one engagement record per user.
  const eng = new Map<string, { last: Date | null; tasks7: number; plans7: number; hours7: number }>();
  const row = (id: string) => {
    let e = eng.get(id);
    if (!e) { e = { last: null, tasks7: 0, plans7: 0, hours7: 0 }; eng.set(id, e); }
    return e;
  };
  const bump = (id: string, d: Date | null | undefined) => {
    if (!d) return;
    const e = row(id);
    if (!e.last || d > e.last) e.last = d;
  };
  for (const t of taskLast) bump(t.userId, t._max.updatedAt);
  for (const p of planLast) bump(p.userId, p._max.updatedAt);
  for (const w of workLast) bump(w.userId, w._max.createdAt);
  for (const s of statusLast) bump(s.userId, s._max.at);
  for (const t of taskCreated7) row(t.userId).tasks7 = t._count._all;
  for (const p of planSubmitted7) row(p.userId).plans7 = p._count._all;
  for (const w of workHours7) row(w.userId).hours7 = w._sum.hours ?? 0;

  const engagement: Record<string, { lastActive: string | null; lastLogin: string | null; activeToday: boolean; tasks7: number; plans7: number; hours7: number }> = {};
  for (const u of users) {
    const e = eng.get(u.id);
    engagement[u.id] = {
      lastActive: e?.last ? e.last.toISOString() : null,
      lastLogin: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
      activeToday: e?.last ? e.last >= todayStart : false,
      tasks7: e?.tasks7 ?? 0,
      plans7: e?.plans7 ?? 0,
      hours7: e?.hours7 ?? 0,
    };
  }

  // ---- Sprint alignment: are members' logged tasks the current-sprint work? ----
  // Match is heuristic (title token-overlap, see lib/sprint) — no one links tasks
  // to sprint items by hand, so a "match" is a best-effort inference, not proof.
  const sprintVersion = settings.currentSprintVersion ?? null;
  const sprintAlignment = await buildSprintAlignment(sprintVersion);

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Admin Panel</h1>
      <AdminClient
        users={JSON.parse(JSON.stringify(users))}
        teams={JSON.parse(JSON.stringify(teams))}
        settings={JSON.parse(JSON.stringify(settings))}
        engagement={engagement}
        sprint={sprintAlignment}
      />
    </div>
  );
}

type SprintMember = {
  userId: string;
  name: string | null;
  email: string | null;
  total: number;
  matched: number;
  items: {
    id: string;
    externalId: string;
    title: string;
    workItemType: string | null;
    state: string | null;
    priority: string | null;
    matchedTaskTitle: string | null;
    matchedTaskDate: string | null;
  }[];
};

type SprintAlignment = {
  version: string | null;
  totalItems: number;
  members: SprintMember[];
  unassignedCount: number;
};

async function buildSprintAlignment(version: string | null): Promise<SprintAlignment> {
  if (!version) return { version: null, totalItems: 0, members: [], unassignedCount: 0 };

  const items = await prisma.sprintItem.findMany({
    where: { version },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: [{ priority: "asc" }, { externalId: "asc" }],
  });

  const assigned = items.filter((i) => i.userId);
  const unassignedCount = items.length - assigned.length;

  // Recent tasks (last 90d) for the assigned users, to match sprint titles against.
  const userIds = [...new Set(assigned.map((i) => i.userId!))];
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const tasks = userIds.length
    ? await prisma.dailyTask.findMany({
        where: { userId: { in: userIds }, date: { gte: since } },
        select: { userId: true, title: true, date: true },
      })
    : [];
  const tasksByUser = new Map<string, { title: string; date: Date }[]>();
  for (const t of tasks) {
    const arr = tasksByUser.get(t.userId) ?? [];
    arr.push({ title: t.title, date: t.date });
    tasksByUser.set(t.userId, arr);
  }

  const byUser = new Map<string, SprintMember>();
  for (const it of assigned) {
    let m = byUser.get(it.userId!);
    if (!m) {
      m = { userId: it.userId!, name: it.user?.name ?? null, email: it.user?.email ?? null, total: 0, matched: 0, items: [] };
      byUser.set(it.userId!, m);
    }
    const cand = tasksByUser.get(it.userId!) ?? [];
    const hit = bestMatch(it.title, cand.map((c) => c.title));
    const matchedTask = hit.index >= 0 ? cand[hit.index] : null;
    m.total++;
    if (matchedTask) m.matched++;
    m.items.push({
      id: it.id,
      externalId: it.externalId,
      title: it.title,
      workItemType: it.workItemType,
      state: it.state,
      priority: it.priority,
      matchedTaskTitle: matchedTask?.title ?? null,
      matchedTaskDate: matchedTask ? matchedTask.date.toISOString() : null,
    });
  }

  const members = [...byUser.values()].sort((a, b) => {
    const ra = a.total ? a.matched / a.total : 0;
    const rb = b.total ? b.matched / b.total : 0;
    return ra - rb; // least-aligned first — those need attention
  });

  return { version, totalItems: items.length, members, unassignedCount };
}
