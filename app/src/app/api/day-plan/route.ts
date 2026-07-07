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

// PATCH /api/day-plan  { goal?: string, submit?: boolean }
// Operates on today's plan only. Setting submit:true freezes the day: the goal
// becomes immutable and the task plan is locked (see /api/tasks routes).
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  const body = await req.json();
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
