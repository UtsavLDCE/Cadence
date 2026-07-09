import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { todayDate } from "@/lib/utils";
import { AllTasksView } from "../dashboard/dashboard-client";

// Full team task list. Manager/admin only — members see their own work on
// "My Day", not everyone's. Spans all days and statuses; the client filters it
// (default: hide DONE) and each row expands to view/edit the task's details.
export default async function TasksPage() {
  const session = await auth();
  const isManager = session!.user.role === "MANAGER" || session!.user.role === "ADMIN";
  if (!isManager) redirect("/dashboard");

  const today = todayDate();

  const [members, allTasks] = await Promise.all([
    // Everyone who can own a task — members, managers, and admins alike — so
    // their rows resolve to a real name and they appear in the owner filter.
    prisma.user.findMany({
      select: { id: true, name: true, email: true },
      orderBy: [{ name: "asc" }],
    }),
    // Every task on the team, all owners, all statuses, all days. Deferred
    // originals are kept so the full record is visible.
    prisma.dailyTask.findMany({
      select: {
        id: true, seq: true, userId: true, title: true, notes: true, status: true, priority: true,
        estimatedHours: true, actualHours: true, date: true, completedAt: true,
        deferredToDate: true, categoryId: true,
        tags: { select: { id: true, name: true } },
      },
      orderBy: [{ date: "desc" }, { createdAt: "asc" }],
    }),
  ]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-[28px] font-semibold tracking-[-0.02em] text-[#1c1a17]">Task List</h1>
        <p className="text-sm text-[#9c968d] mt-0.5">
          Every task across the team. Filter by owner, status, priority, or text — defaults to hiding completed work.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-[#ece8e1] p-5">
        <AllTasksView
          allTasks={JSON.parse(JSON.stringify(allTasks))}
          members={JSON.parse(JSON.stringify(members))}
          todayIso={today.toISOString()}
        />
      </div>
    </div>
  );
}
