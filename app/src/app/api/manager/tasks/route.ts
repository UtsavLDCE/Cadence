import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { todayDate } from "@/lib/utils";
import { parsePriority } from "@/lib/task-status";
import { resolveCategoryId } from "@/lib/task-categories";
import { resolveTagIds, tagsConnectInput, TAGS_INCLUDE } from "@/lib/task-tags";
import { parseHours, parseNotes } from "../../queue/route";

// POST /api/manager/tasks  { userId, title, date?, priority?, estimatedHours?, notes? }
// Managers/admins create a daily task directly on a member's plan from the Task
// List. This is a deliberate override: it bypasses the member's day-plan lock so
// a lead can drop work onto any day (default today), the same way reassign moves
// pending work regardless of the lock.
//
// The estimate is OPTIONAL — a lead may not know the effort yet; the member can
// fill it in. If one is given it must be positive. The new task starts as TODO.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const isManager = session.user.role === "MANAGER" || session.user.role === "ADMIN";
  if (!isManager) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();

  const userId = typeof body.userId === "string" ? body.userId : "";
  if (!userId) return NextResponse.json({ error: "A member is required." }, { status: 400 });

  // The Task List only shows MEMBER-owned tasks, so a task created for a
  // non-member would silently vanish from the view. Require a MEMBER target.
  const member = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
  if (!member) return NextResponse.json({ error: "Member not found." }, { status: 404 });
  if (member.role !== "MEMBER") {
    return NextResponse.json({ error: "Tasks can only be assigned to team members." }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return NextResponse.json({ error: "Title is required." }, { status: 400 });

  // Estimate is optional on creation, but if one is given it must be positive.
  let estimatedHours: number | null = null;
  if (body.estimatedHours !== undefined && body.estimatedHours !== null && body.estimatedHours !== "") {
    const h = parseHours(body.estimatedHours);
    if (h === null || h <= 0) {
      return NextResponse.json({ error: "If you set an estimate, it must be a positive number of hours." }, { status: 400 });
    }
    estimatedHours = h;
  }

  // Target day. Default today; an explicit YYYY-MM-DD is stored at UTC midnight to
  // match the @db.Date column. Reject anything that isn't a real calendar day.
  let date = todayDate();
  if (typeof body.date === "string" && body.date !== "") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      return NextResponse.json({ error: "Date must be in YYYY-MM-DD format." }, { status: 400 });
    }
    const parsed = new Date(`${body.date}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: "That date isn't valid." }, { status: 400 });
    }
    date = parsed;
  }

  const category = await resolveCategoryId(prisma, body.categoryId);
  if (!category.ok) return NextResponse.json({ error: "Unknown category." }, { status: 400 });

  const tags = await resolveTagIds(prisma, body.tagIds);
  if (!tags.ok) return NextResponse.json({ error: "Unknown tag." }, { status: 400 });

  const task = await prisma.dailyTask.create({
    data: {
      userId,
      date,
      title,
      notes: parseNotes(body.notes),
      estimatedHours,
      status: "TODO",
      priority: parsePriority(body.priority) ?? "MEDIUM",
      categoryId: category.id,
      tags: tagsConnectInput(tags.ids),
    },
    include: TAGS_INCLUDE,
  });

  return NextResponse.json(task, { status: 201 });
}
