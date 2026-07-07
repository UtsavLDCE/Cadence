import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// DELETE /api/teams/:id  -> removes an empty team (admin-only).
// Refuses if any user is still a member of the team.
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await ctx.params;

  const team = await prisma.team.findUnique({
    where: { id },
    include: { _count: { select: { members: true } } },
  });
  if (!team) return NextResponse.json({ error: "Team not found" }, { status: 404 });

  if (team._count.members > 0) {
    return NextResponse.json(
      { error: "Remove all members before deleting this team." },
      { status: 409 }
    );
  }

  await prisma.team.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
