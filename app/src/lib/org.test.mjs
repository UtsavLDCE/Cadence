// Run: node app/src/lib/org.test.mjs  (pure logic mirror of subtreeIds)
import assert from "node:assert";

function subtreeIds(users, rootId) {
  const childrenOf = new Map();
  for (const u of users) {
    if (!u.managerId) continue;
    const kids = childrenOf.get(u.managerId);
    if (kids) kids.push(u.id);
    else childrenOf.set(u.managerId, [u.id]);
  }
  const out = [];
  const seen = new Set([rootId]);
  const queue = [...(childrenOf.get(rootId) ?? [])];
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    for (const c of childrenOf.get(id) ?? []) queue.push(c);
  }
  return out;
}

// b:manager, a→b, c→b, d→a (grandchild). B's subtree = {a,c,d}, not just {a,c}.
const org = [
  { id: "b", managerId: null },
  { id: "a", managerId: "b" },
  { id: "c", managerId: "b" },
  { id: "d", managerId: "a" },
];
assert.deepStrictEqual(subtreeIds(org, "b").sort(), ["a", "c", "d"]);
assert.deepStrictEqual(subtreeIds(org, "a"), ["d"]);
assert.deepStrictEqual(subtreeIds(org, "d"), []); // leaf

// Cycle a→b→a must terminate, not hang.
const cyclic = [
  { id: "a", managerId: "b" },
  { id: "b", managerId: "a" },
];
assert.deepStrictEqual(subtreeIds(cyclic, "a"), ["b"]);

console.log("ok");
