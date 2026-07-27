import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseSprintCsv } from "@/lib/sprint";

// Admin uploads a sprint CSV as raw text. Rows are matched to Cadence users by
// email local-part (== the MOTADATA login) and REPLACE any prior rows for the
// same version — re-uploading the same sprint is a clean refresh, including
// removals. The uploaded version becomes the current sprint.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { version, csv } = (await req.json()) as { version?: string; csv?: string };
  if (!version?.trim() || !csv?.trim()) {
    return NextResponse.json({ error: "version and csv are required" }, { status: 400 });
  }
  const ver = version.trim();

  const rows = parseSprintCsv(csv);
  if (rows.length === 0) {
    return NextResponse.json({ error: "No valid rows found in CSV." }, { status: 400 });
  }

  // login -> userId, from Cadence users' email local-part.
  const users = await prisma.user.findMany({ where: { email: { not: null } }, select: { id: true, email: true } });
  const loginToId = new Map<string, string>();
  for (const u of users) {
    const local = u.email!.split("@")[0].toLowerCase();
    loginToId.set(local, u.id);
  }

  const data = rows.map((r) => ({
    version: ver,
    externalId: r.externalId,
    title: r.title,
    workItemType: r.workItemType,
    state: r.state,
    assigneeRaw: r.assigneeRaw,
    assigneeLogin: r.assigneeLogin,
    userId: r.assigneeLogin ? loginToId.get(r.assigneeLogin) ?? null : null,
    tags: r.tags,
    storySize: r.storySize,
    estimate: r.estimate,
    priority: r.priority,
    createdBy: r.createdBy,
    startDate: r.startDate,
    devCompletionDate: r.devCompletionDate,
    dueDate: r.dueDate,
  }));

  const matched = data.filter((d) => d.userId).length;

  await prisma.$transaction([
    prisma.sprintItem.deleteMany({ where: { version: ver } }),
    prisma.sprintItem.createMany({ data, skipDuplicates: true }),
    prisma.appSettings.upsert({
      where: { id: "singleton" },
      update: { currentSprintVersion: ver },
      create: { id: "singleton", currentSprintVersion: ver },
    }),
  ]);

  return NextResponse.json({
    version: ver,
    imported: data.length,
    matched,
    unmatched: data.length - matched,
  });
}
