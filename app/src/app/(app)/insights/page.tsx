import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { todayDate } from "@/lib/utils";
import {
  buildMemberInsights,
  buildTeamInsights,
  categoryBreakdown,
  computeTrends,
  type InsightTaskRow,
  type InsightEventRow,
} from "@/lib/insights";
import { resolveRange, trendBucketDays } from "@/lib/insights-range";
import { InsightsClient } from "./insights-client";
import { MemberMirror } from "./member-mirror";

// Productivity insights. Two audiences, one analytics core:
//   - MANAGER / ADMIN → the team view: where the team's time leaks, per-person.
//   - MEMBER → a personal mirror of their OWN patterns, so logging faithfully
//     pays off downward (self-diagnosis), not only upward (surveillance). Same
//     insights.ts, scoped to self.
const taskSelect = {
  id: true,
  userId: true,
  title: true,
  status: true,
  workType: true,
  unplanned: true,
  priority: true,
  estimatedHours: true,
  actualHours: true,
  date: true,
  completedAt: true,
  deferredToDate: true,
  deferredFromDate: true,
  deferralCause: true,
  categoryId: true,
} as const;

type TaskSelected = {
  id: string;
  userId: string;
  title: string;
  status: InsightTaskRow["status"];
  workType: InsightTaskRow["workType"];
  unplanned: boolean;
  priority: InsightTaskRow["priority"];
  estimatedHours: number | null;
  actualHours: number | null;
  date: Date;
  completedAt: Date | null;
  deferredToDate: Date | null;
  deferredFromDate: Date | null;
  deferralCause: InsightTaskRow["deferralCause"];
  categoryId: string | null;
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function toRow(t: TaskSelected): InsightTaskRow {
  return {
    id: t.id,
    userId: t.userId,
    title: t.title,
    status: t.status,
    workType: t.workType,
    unplanned: t.unplanned,
    priority: t.priority,
    estimatedHours: t.estimatedHours,
    actualHours: t.actualHours,
    date: t.date.toISOString(),
    completedAt: iso(t.completedAt),
    deferredToDate: iso(t.deferredToDate),
    deferredFromDate: iso(t.deferredFromDate),
    deferralCause: t.deferralCause,
    categoryId: t.categoryId,
  };
}

type EventSelected = {
  taskId: string;
  userId: string;
  from: InsightEventRow["from"];
  to: InsightEventRow["to"];
  at: Date;
  blockedOn: string | null;
  note: string | null;
};

function toEvent(e: EventSelected): InsightEventRow {
  return {
    taskId: e.taskId,
    userId: e.userId,
    from: e.from,
    to: e.to,
    at: e.at.toISOString(),
    blockedOn: e.blockedOn,
    note: e.note,
  };
}

const str = (v: string | string[] | undefined): string | undefined => (typeof v === "string" ? v : undefined);

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string | string[]; from?: string | string[]; to?: string | string[] }>;
}) {
  const session = await auth();
  const isManager = session!.user.role === "MANAGER" || session!.user.role === "ADMIN";

  const today = todayDate();
  const sp = await searchParams;
  const range = resolveRange({ range: str(sp.range), from: str(sp.from), to: str(sp.to) }, today);
  const windowStartISO = range.start.toISOString();
  const bucketDays = trendBucketDays(range.days);
  // Windowed queries use [start, endExclusive) so both @db.Date and datetime
  // columns are bounded on the same inclusive-day span.
  const dateWindow = { gte: range.start, lt: range.endExclusive };

  const categoryRows = await prisma.taskCategory.findMany({ select: { id: true, name: true } });
  const categoryNames = new Map(categoryRows.map((c) => [c.id, c.name]));

  // -------------------------------------------------------------- Member mirror
  if (!isManager) {
    const uid = session!.user.id;
    const [windowTasks, wipTasks, events, interruptionCount] = await Promise.all([
      prisma.dailyTask.findMany({ where: { userId: uid, date: dateWindow }, select: taskSelect }),
      prisma.dailyTask.findMany({
        where: { userId: uid, status: { in: ["IN_PROGRESS", "HOLD"] }, deferredToDate: null },
        select: taskSelect,
      }),
      prisma.taskStatusEvent.findMany({
        where: { userId: uid, at: dateWindow },
        select: { taskId: true, userId: true, from: true, to: true, at: true, blockedOn: true, note: true },
      }),
      prisma.interruption.count({ where: { userId: uid, date: dateWindow } }),
    ]);

    const rows = windowTasks.map(toRow);
    const me = buildMemberInsights({
      id: uid,
      name: session!.user.name ?? null,
      email: session!.user.email ?? null,
      team: null,
      tasks: rows,
      wipTasks: wipTasks.map(toRow),
      events: events.map(toEvent),
      interruptionLogCount: interruptionCount,
    });
    const categories = categoryBreakdown(rows, categoryNames);
    const trends = computeTrends(rows, windowStartISO, range.days, bucketDays);

    return (
      <MemberMirror
        me={me}
        categories={categories}
        trends={trends}
        rangeLabel={range.label}
        rangeKey={range.key}
        rangeFrom={range.from}
        rangeTo={range.to}
      />
    );
  }

  // ---------------------------------------------------------------- Team view
  // Everyone is in the report — members, managers, and admins — except users an
  // admin has explicitly excluded (`excludedFromInsights`).
  const [members, windowTasks, wipTasks, events, interruptionGroups] = await Promise.all([
    prisma.user.findMany({
      where: { excludedFromInsights: false },
      select: { id: true, name: true, email: true, team: { select: { name: true } } },
      orderBy: [{ name: "asc" }],
    }),
    prisma.dailyTask.findMany({
      where: { user: { excludedFromInsights: false }, date: dateWindow },
      select: taskSelect,
    }),
    prisma.dailyTask.findMany({
      where: { user: { excludedFromInsights: false }, status: { in: ["IN_PROGRESS", "HOLD"] }, deferredToDate: null },
      select: taskSelect,
    }),
    prisma.taskStatusEvent.findMany({
      where: { at: dateWindow, task: { user: { excludedFromInsights: false } } },
      select: { taskId: true, userId: true, from: true, to: true, at: true, blockedOn: true, note: true },
    }),
    prisma.interruption.groupBy({
      by: ["userId"],
      where: { date: dateWindow, user: { excludedFromInsights: false } },
      _count: { _all: true },
    }),
  ]);

  const allRows = windowTasks.map(toRow);
  const allWip = wipTasks.map(toRow);
  const allEvents = events.map(toEvent);
  const intByUser: Record<string, number> = {};
  for (const g of interruptionGroups) intByUser[g.userId] = g._count._all;

  const memberInsights = members.map((m) =>
    buildMemberInsights({
      id: m.id,
      name: m.name,
      email: m.email,
      team: m.team?.name ?? null,
      tasks: allRows.filter((r) => r.userId === m.id),
      wipTasks: allWip.filter((r) => r.userId === m.id),
      events: allEvents.filter((e) => e.userId === m.id),
      interruptionLogCount: intByUser[m.id] ?? 0,
    }),
  );

  const team = buildTeamInsights(memberInsights, allRows, allEvents, range.days);
  const categorySlices = categoryBreakdown(allRows, categoryNames);
  // Per-person category split — same "where time goes" question, scoped to each
  // member so a manager sees who spends their time on what.
  const membersCategories = members.map((m) => ({
    id: m.id,
    name: m.name ?? m.email ?? "—",
    categories: categoryBreakdown(allRows.filter((r) => r.userId === m.id), categoryNames),
  }));
  const teamTrends = computeTrends(allRows, windowStartISO, range.days, bucketDays);

  return (
    <InsightsClient
      team={team}
      members={memberInsights}
      categories={categorySlices}
      membersCategories={membersCategories}
      trends={teamTrends}
      rangeLabel={range.label}
      rangeKey={range.key}
      rangeFrom={range.from}
      rangeTo={range.to}
    />
  );
}
