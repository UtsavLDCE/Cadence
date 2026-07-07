import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizeTagName } from "@/lib/task-tags";

const tagSelect = { id: true, name: true } as const;

// GET /api/tags  -> the team-wide tag vocabulary, alphabetical.
// Any authenticated user: tags are global so everyone shares (and grows) the same
// set, keeping filters and roll-ups from fragmenting on spelling.
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tags = await prisma.tag.findMany({ orderBy: { name: "asc" }, select: tagSelect });
  return NextResponse.json(tags);
}

// POST /api/tags  { name }  -> add a tag to the shared vocabulary.
// Any authenticated user can extend it. Case-insensitively idempotent: an existing
// name (differing only by case/whitespace) returns the existing row (200) so the
// inline "add tag" flow always yields a usable tag even on a near-duplicate.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const name = normalizeTagName(body.name);
  if (!name) return NextResponse.json({ error: "A tag name is required." }, { status: 400 });

  const existing = await prisma.tag.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
    select: tagSelect,
  });
  if (existing) return NextResponse.json(existing, { status: 200 });

  const created = await prisma.tag.create({
    data: { name, createdById: session.user.id },
    select: tagSelect,
  });
  return NextResponse.json(created, { status: 201 });
}
