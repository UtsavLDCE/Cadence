import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { todayDate } from "@/lib/utils";
import { TimeAuditClient } from "./time-audit-client";

export default async function TimeAuditPage() {
  const session = await auth();
  const role = session!.user.role;
  if (role !== "MANAGER" && role !== "ADMIN") redirect("/standup");

  const today = todayDate();
  const [tasks, slots] = await Promise.all([
    prisma.dailyTask.findMany({
      where: { userId: session!.user.id, date: today, deferredToDate: null },
      orderBy: { createdAt: "asc" },
      select: { id: true, title: true, priority: true, status: true },
    }),
    prisma.timeSlot.findMany({
      where: { userId: session!.user.id, date: today },
      orderBy: { plannedStart: "asc" },
      include: { task: { select: { id: true, title: true, priority: true, status: true } } },
    }),
  ]);

  return (
    <TimeAuditClient
      initialTasks={JSON.parse(JSON.stringify(tasks))}
      initialSlots={JSON.parse(JSON.stringify(slots))}
    />
  );
}
