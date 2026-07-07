import type { Prisma, PrismaClient } from "@prisma/client";

// Read surface shared by the root client and a $transaction client, so category
// resolution works standalone or inside an existing transaction.
type CategoryReader = {
  taskCategory: {
    findUnique: (args: {
      where: { id: string };
      select: { id: true };
    }) => Promise<{ id: string } | null>;
  };
};

// Validate an untrusted categoryId from a request body.
//   - absent / null / "" -> { ok: true, id: null }  (uncategorized, a valid state)
//   - a known category id -> { ok: true, id }
//   - anything else       -> { ok: false }           (caller returns 400)
// Kept as an existence check (one indexed PK lookup) so a bad id fails cleanly
// with a friendly message instead of surfacing a raw FK violation.
export async function resolveCategoryId(
  db: PrismaClient | Prisma.TransactionClient | CategoryReader,
  value: unknown,
): Promise<{ ok: true; id: string | null } | { ok: false }> {
  if (value === null || value === undefined || value === "") return { ok: true, id: null };
  if (typeof value !== "string") return { ok: false };
  const cat = await (db as CategoryReader).taskCategory.findUnique({
    where: { id: value },
    select: { id: true },
  });
  return cat ? { ok: true, id: cat.id } : { ok: false };
}

// Normalize a user-entered category name: trim and collapse internal whitespace.
export function normalizeCategoryName(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 60) : "";
}
