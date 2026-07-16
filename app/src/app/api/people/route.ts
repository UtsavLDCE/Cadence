import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/people — minimal roster (id + name/email) of every user, for the
// "Share with" picker. Any authenticated user may read it: sharing work is not a
// manager-only action, and this exposes only display names, no sensitive fields.
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const people = await prisma.user.findMany({
    where: { id: { not: session.user.id } }, // can't share with yourself
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(people);
}
