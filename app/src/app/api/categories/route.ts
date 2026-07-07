import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizeCategoryName } from "@/lib/task-categories";

const categorySelect = { id: true, name: true, kind: true, sortOrder: true, isDefault: true } as const;

// GET /api/categories  -> the team-wide category vocabulary, ordered for display.
// Any authenticated user: categories are global so everyone shares (and grows) the
// same set, which keeps the /insights roll-up from fragmenting on spelling.
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const categories = await prisma.taskCategory.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: categorySelect,
  });
  return NextResponse.json(categories);
}

// POST /api/categories  { name }  -> add a category to the shared vocabulary.
// Any authenticated user can extend it ("anything not already a category").
// Case-insensitively idempotent: if the name already exists we return the existing
// row (200) rather than erroring, so the "+ Add category" combobox flow always
// yields a usable category even on a near-duplicate.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const name = normalizeCategoryName(body.name);
  if (!name) return NextResponse.json({ error: "A category name is required." }, { status: 400 });

  // Reuse an existing category that only differs by case/whitespace.
  const existing = await prisma.taskCategory.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
    select: categorySelect,
  });
  if (existing) return NextResponse.json(existing, { status: 200 });

  // New categories sort after everything else, preserving the seeded order first.
  const last = await prisma.taskCategory.findFirst({
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });

  const created = await prisma.taskCategory.create({
    data: {
      name,
      sortOrder: (last?.sortOrder ?? -1) + 1,
      createdById: session.user.id,
    },
    select: categorySelect,
  });
  return NextResponse.json(created, { status: 201 });
}
