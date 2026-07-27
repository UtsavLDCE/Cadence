import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { todayDate, formatDate } from "@/lib/utils";
import { TAGS_INCLUDE } from "@/lib/task-tags";
import { PlanForMemberClient } from "./plan-client";

// Plan a member's day — manager/admin only. A lead picks one of the people they
// manage ("followed members" = direct reports; admin sees every member), a day
// (default today), sets that day's goal, and drops tasks straight onto it. This
// is the composing surface for "the manager provides work"; the tasks land on the
// member's My Day exactly like a self-added task, stamped as assigned by the lead.
//
// Member + date are chosen with a no-JS GET form (?member=&date=), matching the
// Daily Feed pattern. The server does every read; the client island only mutates
// (save goal, add task, delete task) and calls router.refresh().

function shiftDay(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ member?: string | string[]; date?: string | string[] }>;
}) {
  const session = await auth();
  const isManager = session!.user.role === "MANAGER" || session!.user.role === "ADMIN";
  if (!isManager) redirect("/dashboard");

  const sp = await searchParams;
  const memberId = (Array.isArray(sp.member) ? sp.member[0] : sp.member) || "";
  const rawDate = Array.isArray(sp.date) ? sp.date[0] : sp.date;
  const targetDate =
    rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) && !Number.isNaN(new Date(`${rawDate}T00:00:00.000Z`).getTime())
      ? new Date(`${rawDate}T00:00:00.000Z`)
      : todayDate();
  const dateStr = targetDate.toISOString().slice(0, 10);

  // Admin plans for anyone; a manager plans for the people who report to them.
  // Only MEMBER-role users, matching the /api/manager/tasks target rule.
  const members = await prisma.user.findMany({
    where:
      session!.user.role === "ADMIN"
        ? { role: "MEMBER" }
        : { role: "MEMBER", managerId: session!.user.id },
    select: { id: true, name: true, email: true },
    orderBy: [{ name: "asc" }],
  });

  const selected = memberId ? members.find((m) => m.id === memberId) ?? null : null;

  // Load the selected member's plan goal + tasks for the chosen day.
  const [plan, tasks] = selected
    ? await Promise.all([
        prisma.dayPlan.findUnique({
          where: { userId_date: { userId: selected.id, date: targetDate } },
          select: { goal: true, submittedAt: true },
        }),
        prisma.dailyTask.findMany({
          where: { userId: selected.id, date: targetDate },
          orderBy: { createdAt: "asc" },
          select: {
            id: true, title: true, notes: true, status: true, priority: true,
            estimatedHours: true, assignedById: true,
            assignedBy: { select: { id: true, name: true, email: true } },
            ...TAGS_INCLUDE,
          },
        }),
      ])
    : [null, []];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-[28px] font-semibold tracking-[-0.02em] text-[#1c1a17]">Plan a member&apos;s day</h1>
        <p className="text-sm text-[#9c968d] mt-0.5">
          Pick who you manage and the day, set their goal, and hand them the work. Tasks land on their My Day.
        </p>
      </div>

      {/* Member + date selector — native GET, no client JS. */}
      <form method="GET" className="flex items-end gap-2 flex-wrap mb-6 bg-white rounded-xl border border-[#ece8e1] p-4">
        <div>
          <label className="block text-xs font-medium text-[#6b665f] mb-1">Member</label>
          <select
            name="member"
            defaultValue={memberId}
            className="border border-[#ece8e1] rounded-lg px-2.5 py-1.5 text-sm text-[#2c2925] bg-white focus:outline-none focus:ring-2 focus:ring-[#e0533a55]"
          >
            <option value="">Pick a member…</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.name || m.email}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-[#6b665f] mb-1">Day</label>
          <div className="flex items-center gap-1.5">
            <a
              href={`/plan?member=${memberId}&date=${shiftDay(dateStr, -1)}`}
              className="px-2.5 py-1.5 rounded-lg border border-[#ece8e1] bg-white text-sm text-[#6b665f] hover:border-primary hover:text-primary transition-colors"
              title="Previous day"
            >
              ←
            </a>
            <input
              type="date"
              name="date"
              defaultValue={dateStr}
              className="border border-[#ece8e1] rounded-lg px-2.5 py-1.5 text-sm text-[#2c2925] bg-white focus:outline-none focus:ring-2 focus:ring-[#e0533a55]"
            />
            <a
              href={`/plan?member=${memberId}&date=${shiftDay(dateStr, 1)}`}
              className="px-2.5 py-1.5 rounded-lg border border-[#ece8e1] bg-white text-sm text-[#6b665f] hover:border-primary hover:text-primary transition-colors"
              title="Next day"
            >
              →
            </a>
          </div>
        </div>
        <button
          type="submit"
          className="text-sm px-3 py-1.5 rounded-lg bg-primary text-white font-medium hover:bg-primary-hover transition-colors"
        >
          Open
        </button>
      </form>

      {!selected ? (
        <div className="bg-white rounded-xl border border-[#ece8e1] p-8 text-center text-sm text-[#9c968d]">
          {members.length === 0
            ? "No members report to you yet. An admin sets who you manage under Admin → Users → Manager."
            : "Pick a member and a day to start planning their work."}
        </div>
      ) : (
        <PlanForMemberClient
          member={selected}
          date={dateStr}
          dateLabel={formatDate(targetDate)}
          initialGoal={plan?.goal ?? ""}
          submitted={Boolean(plan?.submittedAt)}
          initialTasks={JSON.parse(JSON.stringify(tasks))}
        />
      )}
    </div>
  );
}
