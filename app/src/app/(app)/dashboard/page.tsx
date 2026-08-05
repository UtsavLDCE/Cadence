import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { todayDate } from "@/lib/utils";
import { hourLimits } from "@/lib/limits";
import { minPlanHours } from "@/lib/task-status";
import { buildCalendar, calendarGridStart } from "@/lib/work-calendar";
import { DashboardClient } from "./dashboard-client";

// Personal self-reflection dashboard. The Cadence logo routes here for every
// role — a private "how am I doing" view. Team/org aggregation lives in Insights
// and the Daily Feed, not here.
// ponytail: manager/org aggregation removed from this route (the org dashboard is
// gone); the org picture now lives only on /insights + /feed.
export default async function DashboardPage() {
  const session = await auth();
  // CXO is an exec observer with no personal work — send to the team Feed.
  if (session!.user.role === "CXO") redirect("/feed");

  const today = todayDate();
  const userId = session!.user.id;
  const { workdayHours } = await hourLimits();

  // Trailing window for the under-planned signal; the 5-week calendar grid is the
  // widest window, so one query covers both (reflection filters to 14 days).
  const REFLECT_DAYS = 14;
  const reflectStart = new Date(today);
  reflectStart.setUTCDate(reflectStart.getUTCDate() - (REFLECT_DAYS - 1));
  const gridStart = calendarGridStart(today);

  const [tasks, overdue, recent] = await Promise.all([
    prisma.dailyTask.findMany({
      where: { userId, date: today },
      orderBy: { createdAt: "asc" },
    }),
    prisma.dailyTask.findMany({
      where: { userId, status: { notIn: ["DONE", "NOT_WORKED"] }, date: { lt: today }, deferredToDate: null },
      orderBy: { date: "asc" },
    }),
    prisma.dailyTask.findMany({
      where: { userId, date: { gte: gridStart } },
      select: { date: true, estimatedHours: true, actualHours: true },
    }),
  ]);

  // Under-planned days: weekdays in the 14-day window where you planned SOMETHING
  // but total estimated effort fell below the 60% floor. Days with nothing planned
  // are a different signal (skipped planning) and aren't counted here.
  const floor = minPlanHours(workdayHours);
  const plannedByDay = new Map<string, number>();
  for (const t of recent) {
    if (t.date < reflectStart) continue;
    const d = new Date(t.date);
    const wd = d.getUTCDay();
    if (wd === 0 || wd === 6) continue; // weekends off
    const key = d.toISOString().slice(0, 10);
    plannedByDay.set(key, (plannedByDay.get(key) ?? 0) + (t.estimatedHours ?? 0));
  }
  const underPlannedDays = [...plannedByDay.values()].filter((h) => h > 0 && h < floor).length;

  // Work calendar (worked vs planned per day) — shared with the Profile page.
  const { calendar, weeks } = buildCalendar(recent, today);

  return (
    <DashboardClient
      todayIso={today.toISOString()}
      myTasks={JSON.parse(JSON.stringify(tasks))}
      myOverdue={JSON.parse(JSON.stringify(overdue))}
      reflection={{ underPlannedDays, windowDays: REFLECT_DAYS, floorHours: floor }}
      calendar={JSON.parse(JSON.stringify(calendar))}
      weeks={JSON.parse(JSON.stringify(weeks))}
    />
  );
}
