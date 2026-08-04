import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/notes — the caller's own notes, newest first. Notes are private:
// a user only ever sees their own.
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const notes = await prisma.note.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, body: true, done: true, createdAt: true },
  });
  return NextResponse.json(notes);
}

// POST /api/notes  { body, title?, todo? }  -> add one dated note. `body` is an
// optional raw string; empty/whitespace-only is rejected. `title` is an optional
// recall name ("SLA discussion with Lead"). `todo: true` makes it a checkable
// todo (done=false); otherwise a plain note (done=null, no checkbox).
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const payload = await req.json().catch(() => ({}));
  const body = typeof payload.body === "string" ? payload.body.trim() : "";
  if (!body) return NextResponse.json({ error: "A note can't be empty." }, { status: 400 });
  const title = typeof payload.title === "string" && payload.title.trim() ? payload.title.trim() : null;

  const note = await prisma.note.create({
    data: { userId: session.user.id, title, body, done: payload.todo === true ? false : null },
    select: { id: true, title: true, body: true, done: true, createdAt: true },
  });
  return NextResponse.json(note, { status: 201 });
}

// PATCH /api/notes  { id, done? | title?, body? }  -> edit a note. Either toggle
// a todo's done state, or edit its title/body. Scoped to the caller's own notes;
// updateMany returns count 0 if the id isn't theirs.
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const payload = await req.json().catch(() => ({}));
  const id = typeof payload.id === "string" ? payload.id : "";
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });

  const data: { done?: boolean; title?: string | null; body?: string } = {};
  if (typeof payload.done === "boolean") data.done = payload.done;
  if (typeof payload.body === "string") {
    const body = payload.body.trim();
    if (!body) return NextResponse.json({ error: "A note can't be empty." }, { status: 400 });
    data.body = body;
  }
  if (typeof payload.title === "string") data.title = payload.title.trim() || null;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const { count } = await prisma.note.updateMany({
    where: { id, userId: session.user.id },
    data,
  });
  if (count === 0) return NextResponse.json({ error: "Note not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
