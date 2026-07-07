import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { todayDate } from "@/lib/utils";
import { INSIGHTS_WINDOW_DAYS, categoryBreakdown } from "@/lib/insights";
import { ProfileClient } from "./profile-client";

// How many trailing days the "work hours vs planning" chart spans.
const CHART_DAYS = 7;

export default async function ProfilePage() {
  const session = await auth();
  const today = todayDate();
  const userId = session!.user.id;

  const [recent, doneCount, categoryTasks, categoryRows] = await Promise.all([
    // Recent activity window (last 14 days) for the completion summary and the
    // daily planned-vs-worked chart (which reads the trailing CHART_DAYS of it).
    prisma.dailyTask.findMany({
      where: { userId, date: { gte: addDays(today, -14) } },
      select: { status: true, date: true, estimatedHours: true, actualHours: true },
    }),
    prisma.dailyTask.count({ where: { userId, status: "DONE" } }),
    // "Where your time goes" spans the same trailing window as the team Insights
    // view (INSIGHTS_WINDOW_DAYS, inclusive of today) so the horizon is
    // consistent across surfaces.
    prisma.dailyTask.findMany({
      where: { userId, date: { gte: addDays(today, -(INSIGHTS_WINDOW_DAYS - 1)) } },
      select: { estimatedHours: true, actualHours: true, categoryId: true, deferredToDate: true },
    }),
    prisma.taskCategory.findMany({ select: { id: true, name: true } }),
  ]);

  // Where this person's own effort went over the Insights window, by category.
  const categoryNames = new Map(categoryRows.map((c) => [c.id, c.name]));
  const categories = categoryBreakdown(
    categoryTasks.map((t) => ({
      deferredToDate: t.deferredToDate ? t.deferredToDate.toISOString() : null,
      actualHours: t.actualHours,
      estimatedHours: t.estimatedHours,
      categoryId: t.categoryId,
    })),
    categoryNames,
  );

  const planned = recent.length;
  const doneRecent = recent.filter((t) => t.status === "DONE");
  const completed = doneRecent.length;
  const completionRate = planned ? Math.round((completed / planned) * 100) : 0;

  // Planning accuracy over the 14-day window — estimate vs actual on completed
  // tasks only (partial actuals on unfinished work would skew it "under").
  const estDone = doneRecent.reduce((s, t) => s + (t.estimatedHours ?? 0), 0);
  const actDone = doneRecent.reduce((s, t) => s + (t.actualHours ?? 0), 0);

  // Daily planned (estimated) vs worked (actual) hours for the trailing week.
  // Planned = sum of estimates on tasks planned that day; worked = sum of actual
  // hours logged on that day's tasks. Empty days are kept so the axis is continuous.
  const daily = [];
  for (let i = CHART_DAYS - 1; i >= 0; i--) {
    const d = addDays(today, -i);
    const key = ymd(d);
    const dayTasks = recent.filter((t) => ymd(t.date) === key);
    daily.push({
      date: key,
      planned: round1(dayTasks.reduce((s, t) => s + (t.estimatedHours ?? 0), 0)),
      worked: round1(dayTasks.reduce((s, t) => s + (t.actualHours ?? 0), 0)),
    });
  }

  return (
    <ProfileClient
      user={{ name: session!.user.name ?? null, email: session!.user.email ?? null, role: session!.user.role }}
      daily={daily}
      categories={categories}
      stats={{
        completionRate,
        completed14: completed,
        planned14: planned,
        doneAllTime: doneCount,
        estDone14: estDone,
        actDone14: actDone,
      }}
    />
  );
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// Calendar day (UTC) of a @db.Date value — dates are stored at UTC midnight, so
// bucket on the UTC day to match how the day was planned.
function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
