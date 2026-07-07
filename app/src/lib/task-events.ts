import type { Prisma, PrismaClient, TaskStatus } from "@prisma/client";

// Minimal write surface shared by the root client and a $transaction client, so
// recordStatusChange can run standalone or inside an existing transaction.
type StatusEventWriter = {
  taskStatusEvent: {
    create: (args: { data: Prisma.TaskStatusEventUncheckedCreateInput }) => unknown;
  };
};

// Extra context captured on a transition. Only meaningful when `to === "HOLD"`:
// why the task is blocked and who/which team it's waiting on. Ignored (stored
// null) for other transitions so the log stays clean.
export type StatusChangeMeta = {
  note?: string | null;
  blockedOn?: string | null;
};

function clean(v: string | null | undefined, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, max);
  return t === "" ? null : t;
}

// Record a task status transition. `from` is null on create. No-ops when the
// status didn't actually change, so callers can fire it unconditionally after an
// update without polluting the log. Returns the create promise (or undefined) so
// a caller inside a $transaction can push it into the ops array. HOLD metadata
// (note / blockedOn) is only persisted when the task is actually entering HOLD.
export function recordStatusChange(
  db: PrismaClient | Prisma.TransactionClient | StatusEventWriter,
  taskId: string,
  userId: string,
  from: TaskStatus | null,
  to: TaskStatus,
  meta?: StatusChangeMeta,
) {
  if (from === to) return undefined;
  const hold = to === "HOLD";
  return (db as StatusEventWriter).taskStatusEvent.create({
    data: {
      taskId,
      userId,
      from,
      to,
      note: hold ? clean(meta?.note, 500) : null,
      blockedOn: hold ? clean(meta?.blockedOn, 120) : null,
    },
  });
}
