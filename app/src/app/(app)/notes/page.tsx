import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NotesClient } from "./notes-client";

// Personal notes — a single date-grouped feed of the caller's own free-form
// notes, with an add box on top. Private: everyone sees only their own.
export default async function NotesPage() {
  const session = await auth();

  const notes = await prisma.note.findMany({
    where: { userId: session!.user.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, body: true, done: true, createdAt: true },
  });

  return <NotesClient notes={notes.map((n) => ({ ...n, createdAt: n.createdAt.toISOString() }))} />;
}
