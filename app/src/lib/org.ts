import { prisma } from "@/lib/prisma";

// Pure subtree walk over reporting edges: given every (id, managerId) pair,
// return all descendants of `rootId` — transitively — excluding the root. A
// `seen` set makes a mis-configured cycle (A→B→A) terminate instead of looping.
export function subtreeIds(
  users: { id: string; managerId: string | null }[],
  rootId: string,
): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const u of users) {
    if (!u.managerId) continue;
    const kids = childrenOf.get(u.managerId);
    if (kids) kids.push(u.id);
    else childrenOf.set(u.managerId, [u.id]);
  }

  const out: string[] = [];
  const seen = new Set<string>([rootId]);
  const queue = [...(childrenOf.get(rootId) ?? [])];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    for (const c of childrenOf.get(id) ?? []) queue.push(c);
  }
  return out;
}

// Every user in a manager's reporting subtree — direct reports, their reports,
// and so on down to the leaves. Excludes the manager themselves.
//
// The old scope was one level deep (`{ managerId: me }`); this walks the whole
// tree so a lead sees everyone beneath them, not just their immediate reports.
// ponytail: loads all (id, managerId) rows and walks in memory; swap for a
// recursive CTE only if the org grows to thousands and this read profiles hot.
export async function descendantUserIds(managerId: string): Promise<string[]> {
  const users = await prisma.user.findMany({ select: { id: true, managerId: true } });
  return subtreeIds(users, managerId);
}
