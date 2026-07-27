import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { todayDate } from "@/lib/utils";
import type { Prisma } from "@prisma/client";

// GET /api/day-plan -> the caller's plan (goal + submission state) for today.
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const plan = await prisma.dayPlan.findUnique({
    where: { userId_date: { userId: session.user.id, date: todayDate() } },
  });
  return NextResponse.json(plan);
}

// PATCH /api/day-plan  { goal?: string, submit?: boolean, userId?, date? }
// Self path (no userId): operates on the caller's plan for today only. Setting
// submit:true freezes the day: the goal becomes immutable and the task plan is
// locked (see /api/tasks routes).
//
// Manager path (userId set): a manager/admin sets a MEMBER's day goal for any
// date (default today) while planning their day. This is a deliberate override —
// like /api/manager/tasks it bypasses the member's submitted-lock, since a lead
// providing work shouldn't be blocked by the member having already submitted.
// The manager path never submits the plan; the member still owns their lock.
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();

  // ---- Manager path: set another user's day goal ----
  if (typeof body.userId === "string" && body.userId && body.userId !== session.user.id) {
    const isManager = session.user.role === "MANAGER" || session.user.role === "ADMIN";
    if (!isManager) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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

    const g = typeof body.goal === "string" ? body.goal.trim().slice(0, 500) : "";
    const goal = g === "" ? null : g;
    const plan = await prisma.dayPlan.upsert({
      where: { userId_date: { userId: body.userId, date } },
      update: { goal },
      create: { userId: body.userId, date, goal },
    });
    return NextResponse.json(plan);
  }

  // ---- Self path (unchanged): today's own plan ----
  const today = todayDate();
  const existing = await prisma.dayPlan.findUnique({
    where: { userId_date: { userId: session.user.id, date: today } },
  });

  if (existing?.submittedAt) {
    return NextResponse.json(
      { error: "Today's plan is already submitted and can no longer be changed." },
      { status: 400 },
    );
  }

  const data: Prisma.DayPlanUpdateInput = {};

  if ("goal" in body) {
    const g = typeof body.goal === "string" ? body.goal.trim().slice(0, 500) : "";
    data.goal = g === "" ? null : g;
  }

  if (body.submit === true) {
    data.submittedAt = new Date();
  }

  const plan = await prisma.dayPlan.upsert({
    where: { userId_date: { userId: session.user.id, date: today } },
    update: data,
    create: {
      userId: session.user.id,
      date: today,
      goal: typeof data.goal === "string" ? data.goal : null,
      submittedAt: body.submit === true ? new Date() : null,
    },
  });

  return NextResponse.json(plan);
}
