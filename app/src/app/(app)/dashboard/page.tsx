import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { todayDate } from "@/lib/utils";
import { DashboardClient } from "./dashboard-client";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string | string[] }>;
}) {
  const session = await auth();
  const today = todayDate();
  const isManager = session!.user.role === "MANAGER" || session!.user.role === "ADMIN";

  // Audience scope: "team" = only this manager's direct reports (User.managerId
  // === me, the reporting line); "org" = everyone. Default is role-based — a
  // manager lands on their own reports, an admin on the whole org. Members never
  // reach the manager view below, so scope is irrelevant to them.
  const sp = await searchParams;
  const rawScope = Array.isArray(sp.scope) ? sp.scope[0] : sp.scope;
  const scope: "team" | "org" =
    rawScope === "team" || rawScope === "org"
      ? rawScope
      : session!.user.role === "ADMIN"
        ? "org"
        : "team";
  const scopeFilter = scope === "team" ? { managerId: session!.user.id } : {};

  const settings = await prisma.appSettings.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });

  if (!isManager) {
    const [tasks, overdue] = await Promise.all([
      prisma.dailyTask.findMany({
        where: { userId: session!.user.id, date: today },
        orderBy: { createdAt: "asc" },
      }),
      prisma.dailyTask.findMany({
        where: { userId: session!.user.id, status: { not: "DONE" }, date: { lt: today }, deferredToDate: null },
        orderBy: { date: "asc" },
      }),
    ]);

    return (
      <DashboardClient
        isManager={false}
        todayIso={today.toISOString()}
        cutoffTime={settings.cutoffTime}
        myTasks={JSON.parse(JSON.stringify(tasks))}
        myOverdue={JSON.parse(JSON.stringify(overdue))}
        members={[]}
      />
    );
  }

  // Discipline window: trailing 14 calendar days (inclusive of today)
  const windowStart = new Date(today);
  windowStart.setDate(windowStart.getDate() - 13);

  // "Done today" window: completedAt within today's UTC day. completedAt is a real
  // timestamp (set when a task goes DONE), so this catches work finished today even
  // if it was planned for an earlier day — i.e. effort beyond the defined plan.
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  // Manager / Admin: aggregate the team
  const [users, todayTasks, overdueGroups, historyTasks, doneTodayTasks, pendingTasks] = await Promise.all([
    prisma.user.findMany({
      where: { role: "MEMBER", ...scopeFilter },
      select: { id: true, name: true, email: true, team: { select: { name: true } } },
      orderBy: [{ name: "asc" }],
    }),
    prisma.dailyTask.findMany({
      where: { date: today },
      select: {
        id: true, userId: true, title: true, notes: true, status: true, priority: true,
        estimatedHours: true, actualHours: true,
        deferredToDate: true, deferralCause: true, deferralNote: true,
      },
    }),
    prisma.dailyTask.groupBy({
      by: ["userId"],
      where: { status: { not: "DONE" }, date: { lt: today }, deferredToDate: null },
      _count: { _all: true },
    }),
    prisma.dailyTask.findMany({
      where: { date: { gte: windowStart } },
      select: { userId: true, date: true, status: true, updatedAt: true },
    }),
    prisma.dailyTask.findMany({
      where: { status: "DONE", completedAt: { gte: today, lt: tomorrow } },
      select: {
        id: true, userId: true, title: true, priority: true,
        estimatedHours: true, actualHours: true, date: true,
      },
      orderBy: { completedAt: "asc" },
    }),
    // Every still-pending task across the team (any day), excluding deferred
    // audit rows. This is the backlog a manager can rebalance by reassigning.
    prisma.dailyTask.findMany({
      where: { status: { not: "DONE" }, deferredToDate: null, user: { role: "MEMBER", ...scopeFilter } },
      select: {
        id: true, userId: true, title: true, status: true, priority: true,
        estimatedHours: true, date: true,
      },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  const overdueByUser: Record<string, number> = {};
  for (const g of overdueGroups) overdueByUser[g.userId] = g._count._all;

  // Discipline: how consistently each person plans + follows through.
  // Denominator = number of distinct days the team was active, so weekends
  // and holidays (when nobody plans) never count against anyone.
  const dateKey = (d: Date) => new Date(d).toISOString().slice(0, 10);
  const activeDays = new Set(historyTasks.map((t) => dateKey(t.date))).size || 1;

  type Agg = { days: Set<string>; total: number; done: number; lastActive: number };
  const byUser = new Map<string, Agg>();
  for (const t of historyTasks) {
    let e = byUser.get(t.userId);
    if (!e) {
      e = { days: new Set(), total: 0, done: 0, lastActive: 0 };
      byUser.set(t.userId, e);
    }
    e.days.add(dateKey(t.date));
    e.total++;
    if (t.status === "DONE") e.done++;
    e.lastActive = Math.max(e.lastActive, new Date(t.updatedAt).getTime());
  }

  const members = users.map((u) => {
    const tasks = todayTasks.filter((t) => t.userId === u.id);
    // Everything this member marked DONE today. `planned` is true when the task
    // was on today's plan (date === today); false means it was carried over from
    // an earlier day and cleared today — work beyond the defined plan.
    const doneToday = doneTodayTasks
      .filter((t) => t.userId === u.id)
      .map((t) => ({
        id: t.id,
        title: t.title,
        priority: t.priority,
        estimatedHours: t.estimatedHours,
        actualHours: t.actualHours,
        planned: new Date(t.date).getTime() === today.getTime(),
      }));
    const e = byUser.get(u.id);
    const daysPlanned = e?.days.size ?? 0;
    const total = e?.total ?? 0;
    const done = e?.done ?? 0;
    const planConsistency = Math.min(1, daysPlanned / activeDays);
    const completionRate = total ? done / total : 0;
    const score = Math.round(100 * (0.6 * planConsistency + 0.4 * completionRate));
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      team: u.team?.name ?? null,
      tasks,
      doneToday,
      overdue: overdueByUser[u.id] ?? 0,
      discipline: {
        score,
        daysPlanned,
        activeDays,
        completionPct: Math.round(completionRate * 100),
        plannedToday: tasks.length > 0,
        lastActiveIso: e?.lastActive ? new Date(e.lastActive).toISOString() : null,
      },
    };
  });

  return (
    <DashboardClient
      isManager={true}
      scope={scope}
      todayIso={today.toISOString()}
      cutoffTime={settings.cutoffTime}
      myTasks={[]}
      myOverdue={[]}
      members={JSON.parse(JSON.stringify(members))}
      pendingTasks={JSON.parse(JSON.stringify(pendingTasks))}
    />
  );
}
