import type { Prisma, PrismaClient } from "@prisma/client";

// Read surface shared by the root client and a $transaction client, so tag
// resolution works standalone or inside an existing transaction.
type TagReader = {
  tag: {
    findMany: (args: {
      where: { id: { in: string[] } };
      select: { id: true };
    }) => Promise<{ id: string }[]>;
  };
};

// Normalize a user-entered tag name: trim, collapse internal whitespace, cap length.
export function normalizeTagName(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 40) : "";
}

// Validate an untrusted tagIds array from a request body.
//   - absent / undefined       -> { ok: true, ids: null }   (leave tags untouched)
//   - []                       -> { ok: true, ids: [] }      (clear all tags)
//   - array of known tag ids   -> { ok: true, ids }          (deduped, order-preserved)
//   - anything else / unknown  -> { ok: false }              (caller returns 400)
// One indexed query verifies every id exists, so a bad id fails cleanly with a
// friendly message instead of a raw FK violation on connect.
export async function resolveTagIds(
  db: PrismaClient | Prisma.TransactionClient | TagReader,
  value: unknown,
): Promise<{ ok: true; ids: string[] | null } | { ok: false }> {
  if (value === undefined) return { ok: true, ids: null };
  if (!Array.isArray(value)) return { ok: false };
  const ids = [...new Set(value.filter((v): v is string => typeof v === "string" && v !== ""))];
  if (ids.length === 0) return { ok: true, ids: [] };
  const found = await (db as TagReader).tag.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  if (found.length !== ids.length) return { ok: false };
  return { ok: true, ids };
}

// Relation-write for an UPDATE: `set` replaces the whole tag list (idempotent).
// Null ids -> undefined so the relation is left untouched on a partial patch.
export function tagsSetInput(ids: string[] | null): Prisma.DailyTaskUpdateInput["tags"] {
  return ids === null ? undefined : { set: ids.map((id) => ({ id })) };
}

// Relation-write for a CREATE: `connect` links existing tags (Prisma create has no
// `set`). Null/empty -> undefined so the task is created with no tags.
export function tagsConnectInput(ids: string[] | null): Prisma.DailyTaskCreateInput["tags"] {
  return ids && ids.length ? { connect: ids.map((id) => ({ id })) } : undefined;
}

// Nested `include` for returning a task's tags in a lean {id,name} shape, matching
// the client Tag type. Reused across every route that echoes a task back.
export const TAGS_INCLUDE = { tags: { select: { id: true, name: true } } } as const;
