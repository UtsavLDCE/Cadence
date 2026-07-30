import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const settings = await prisma.appSettings.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });

  return NextResponse.json(settings);
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { cutoffTime, timezone, maxTaskHours, workdayHours } = body as {
    cutoffTime?: string;
    timezone?: string;
    maxTaskHours?: number;
    workdayHours?: number;
  };

  // Hour caps must be positive numbers when supplied; a bad value is rejected
  // rather than silently coerced, so the admin knows the save didn't take.
  const badHours = (v: unknown) => v !== undefined && (typeof v !== "number" || !Number.isFinite(v) || v <= 0);
  if (badHours(maxTaskHours) || badHours(workdayHours)) {
    return NextResponse.json({ error: "Hour caps must be positive numbers." }, { status: 400 });
  }

  const settings = await prisma.appSettings.upsert({
    where: { id: "singleton" },
    update: {
      ...(cutoffTime && { cutoffTime }),
      ...(timezone && { timezone }),
      ...(maxTaskHours !== undefined && { maxTaskHours }),
      ...(workdayHours !== undefined && { workdayHours }),
    },
    create: { id: "singleton" },
  });

  return NextResponse.json(settings);
}
