import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { todayDate } from "@/lib/utils";
import { TAGS_INCLUDE } from "@/lib/task-tags";
import { WORKLOG_INCLUDE } from "@/lib/worklog";
import { TasksClient } from "./tasks-client";

export default async function MyDayPage() {
  const session = await auth();
  // CXO has no personal work — no My Day.
  if (session!.user.role === "CXO") redirect("/feed");
  const today = todayDate();

  const [tasks, overdue, queue, settings, dayPlan] = await Promise.all([
    prisma.dailyTask.findMany({
      where: { userId: session!.user.id, date: today },
      orderBy: { createdAt: "asc" },
      include: {
        ...TAGS_INCLUDE,
        ...WORKLOG_INCLUDE,
        assignedBy: { select: { name: true, email: true } },
      },
    }),
    prisma.dailyTask.findMany({
      where: { userId: session!.user.id, status: { notIn: ["DONE", "NOT_WORKED"] }, date: { lt: today }, deferredToDate: null },
      orderBy: { date: "asc" },
      include: { ...TAGS_INCLUDE, ...WORKLOG_INCLUDE },
    }),
    prisma.queueItem.findMany({
      where: { userId: session!.user.id },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    }),
    prisma.appSettings.upsert({
      where: { id: "singleton" },
      update: {},
      create: { id: "singleton" },
    }),
    prisma.dayPlan.findUnique({
      where: { userId_date: { userId: session!.user.id, date: today } },
    }),
  ]);

  // An overdue task's title can only be edited if its original day was never
  // locked (PATCH /api/tasks/:id rejects title changes on a submitted day). Look
  // up which of the overdue dates carry a submitted plan so the UI offers the
  // rename affordance only where the API would accept it.
  const overdueDates = [...new Set(overdue.map((t) => t.date.getTime()))].map((ms) => new Date(ms));
  const lockedPlans = overdueDates.length
    ? await prisma.dayPlan.findMany({
        where: { userId: session!.user.id, date: { in: overdueDates }, submittedAt: { not: null } },
        select: { date: true },
      })
    : [];
  const lockedDateSet = new Set(lockedPlans.map((p) => p.date.getTime()));
  const overdueWithLock = overdue.map((t) => ({ ...t, locked: lockedDateSet.has(t.date.getTime()) }));

  // Who each of today's tasks was shared with, and whether they've accepted yet.
  // Grouped by the source task so each row can show its recipients (yellow =
  // still pending, green = accepted).
  const taskIds = tasks.map((t) => t.id);
  const sentInvites = taskIds.length
    ? await prisma.taskInvite.findMany({
        where: { fromUserId: session!.user.id, sourceTaskId: { in: taskIds } },
        select: { sourceTaskId: true, status: true, toUser: { select: { name: true, email: true } } },
      })
    : [];
  const sharedByTask = new Map<string, { name: string; status: string }[]>();
  for (const inv of sentInvites) {
    if (!inv.sourceTaskId) continue;
    const list = sharedByTask.get(inv.sourceTaskId) ?? [];
    list.push({ name: inv.toUser.name ?? inv.toUser.email ?? "Someone", status: inv.status });
    sharedByTask.set(inv.sourceTaskId, list);
  }
  const tasksWithShares = tasks.map((t) => ({ ...t, sharedWith: sharedByTask.get(t.id) ?? [] }));

  // Teammates (same Team group) who haven't locked in today's plan yet — a peer
  // nudge shown as a caution on My Day. Scoped strictly to the viewer's own team;
  // no cross-team visibility. Empty when the user has no team.
  const teamId = session!.user.teamId;
  const unsubmittedTeammates = teamId
    ? (
        await prisma.user.findMany({
          where: {
            teamId,
            id: { not: session!.user.id },
            role: { not: "CXO" },
            dayPlans: { none: { date: today, submittedAt: { not: null } } },
          },
          select: { name: true, email: true },
          orderBy: { name: "asc" },
        })
      ).map((u) => u.name ?? u.email ?? "Someone")
    : [];

  return (
    <div>
      <TasksClient
        initialTasks={JSON.parse(JSON.stringify(tasksWithShares))}
        initialQueue={JSON.parse(JSON.stringify(queue))}
        initialOverdue={JSON.parse(JSON.stringify(overdueWithLock))}
        cutoffTime={settings.cutoffTime}
        initialSubmitted={Boolean(dayPlan?.submittedAt)}
        userName={session!.user.name ?? null}
        isAdmin={session!.user.role === "ADMIN"}
        isManager={session!.user.role === "MANAGER" || session!.user.role === "ADMIN"}
        unsubmittedTeammates={unsubmittedTeammates}
        maxTaskHours={settings.maxTaskHours}
        workdayHours={settings.workdayHours}
      />
    </div>
  );
}
