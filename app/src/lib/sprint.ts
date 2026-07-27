// Sprint CSV import + alignment matching.
//
// The CSV is an Azure DevOps-style export: quoted fields that can contain commas
// AND embedded newlines, plus a leading BOM. That rules out a naive line/comma
// split, so we run a small RFC4180 state machine. ponytail: hand-rolled parser
// (zero deps) rather than pulling in papaparse — swap to it if real uploads
// expose an edge case this misses.

/** RFC4180 parse into rows of string cells. Handles quotes, "" escapes, embedded
 *  commas/newlines, CRLF, and a leading BOM. */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input; // strip BOM
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } // escaped quote
        else inQuotes = false;
      } else cell += c;
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\r") { /* ignore, handled by \n */ }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  // trailing cell/row (file may not end with newline)
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

export type ParsedSprintRow = {
  externalId: string;
  workItemType: string | null;
  state: string | null;
  title: string;
  assigneeRaw: string | null;
  assigneeLogin: string | null;
  tags: string | null;
  storySize: string | null;
  estimate: string | null;
  priority: string | null;
  createdBy: string | null;
  startDate: Date | null;
  devCompletionDate: Date | null;
  dueDate: Date | null;
};

// "Vivek Patel <MOTADATA\vivek.patel>" -> "vivek.patel". The login equals the
// email local-part, which is how we join to a Cadence user.
export function extractLogin(assigneeRaw: string | null | undefined): string | null {
  if (!assigneeRaw) return null;
  const m = assigneeRaw.match(/MOTADATA\\([^>]+)/i);
  return m ? m[1].trim().toLowerCase() : null;
}

// "7/15/2025 3:31:06 PM" (M/D/Y) -> UTC-midnight Date, matching the @db.Date
// columns (DailyTask.date etc. are stored as UTC midnight). Returns null on blank.
export function parseMdyDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const datePart = raw.trim().split(" ")[0];
  const m = datePart.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  return new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
}

const clean = (s: string | undefined): string | null => {
  const v = (s ?? "").trim();
  return v.length ? v : null;
};

// Map header names -> row cells so column order doesn't have to be fixed.
export function parseSprintCsv(input: string): ParsedSprintRow[] {
  const rows = parseCsv(input);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name.toLowerCase());
  const idx = {
    id: col("ID"),
    type: col("Work Item Type"),
    state: col("State"),
    title: col("Title"),
    assignee: col("Assigned To"),
    tags: col("Tags"),
    size: col("Story Size"),
    estimate: col("Estimate Efforts"),
    priority: col("Priority"),
    createdBy: col("Created By"),
    start: col("Start Date"),
    devDone: col("Dev Completion Date"),
    due: col("Due Date"),
  };
  const at = (r: string[], i: number) => (i >= 0 ? r[i] : undefined);

  const out: ParsedSprintRow[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const externalId = clean(at(row, idx.id));
    const title = clean(at(row, idx.title));
    if (!externalId || !title) continue; // skip blank/garbage lines
    const assigneeRaw = clean(at(row, idx.assignee));
    out.push({
      externalId,
      title,
      workItemType: clean(at(row, idx.type)),
      state: clean(at(row, idx.state)),
      assigneeRaw,
      assigneeLogin: extractLogin(assigneeRaw),
      tags: clean(at(row, idx.tags)),
      storySize: clean(at(row, idx.size)),
      estimate: clean(at(row, idx.estimate)),
      priority: clean(at(row, idx.priority)),
      createdBy: clean(at(row, idx.createdBy)),
      startDate: parseMdyDate(at(row, idx.start)),
      devCompletionDate: parseMdyDate(at(row, idx.devDone)),
      dueDate: parseMdyDate(at(row, idx.due)),
    });
  }
  return out;
}

// ---- Alignment: is a member actually working on a sprint item? ----------------
// No human links sprint items to Cadence tasks, so alignment is inferred from
// title similarity. ponytail: heuristic token-overlap match with a known ceiling
// (misses reworded titles, over-matches short generic ones). Upgrade path: let
// members explicitly link a task to a sprint item, or use embeddings, if noise
// hurts. Kept deliberately conservative so a "match" badge means something.

const STOP = new Set([
  "the", "a", "an", "and", "or", "of", "to", "for", "in", "on", "with", "from",
  "add", "new", "fix", "update", "support", "supporting", "enhancement", "issue",
  "page", "field", "fields", "based", "when", "via", "into",
]);

export function titleTokens(title: string): Set<string> {
  const norm = title
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, " ") // drop [QA] / [Motadata Support] prefixes
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const toks = norm.split(" ").filter((t) => t.length >= 3 && !STOP.has(t));
  return new Set(toks);
}

// Jaccard over meaningful tokens. Threshold picked to favour precision.
export function titleScore(a: string, b: string): number {
  const ta = titleTokens(a);
  const tb = titleTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

export const TITLE_MATCH_THRESHOLD = 0.35;

/** Best-matching candidate title index for a sprint title, or -1 if none clears
 *  the threshold. Also requires >=2 shared meaningful tokens to avoid single
 *  generic-word matches. */
export function bestMatch(sprintTitle: string, candidates: string[]): { index: number; score: number } {
  let bestIndex = -1;
  let bestScore = 0;
  const st = titleTokens(sprintTitle);
  for (let i = 0; i < candidates.length; i++) {
    const score = titleScore(sprintTitle, candidates[i]);
    if (score <= bestScore) continue;
    // shared-token guard
    let shared = 0;
    const ct = titleTokens(candidates[i]);
    for (const t of st) if (ct.has(t)) shared++;
    if (shared < 2) continue;
    if (score >= TITLE_MATCH_THRESHOLD) { bestScore = score; bestIndex = i; }
  }
  return { index: bestIndex, score: bestScore };
}

// Sprint estimate strings are freeform ("1 Hour", "15 minutes", "1.5 hr", "2h",
// "3 hrs"). Pull the leading number; a "m…" unit means minutes, anything else
// hours. Returns null on blank/garbage so the caller can pick a fallback.
// ponytail: leading-number + unit-prefix covers the shapes this export produces.
export function parseEstimateHours(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = raw.trim().match(/([\d.]+)\s*([a-z]*)/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return m[2].toLowerCase().startsWith("m") ? n / 60 : n;
}

// States that mean work is underway (vs Open/To Do/Closed/Resolved/Wont Fix).
// Used to flag a sprint item as "already started" for the add-to-today action.
export const STARTED_STATES = new Set([
  "In Process", "In Review", "QA Started", "Under Investigation",
  "Waiting For Backend", "On Hold",
]);

// Terminal states — work is done, nothing to pull onto today. Shown in a
// separate "Resolved" section, out of the actionable list.
export const RESOLVED_STATES = new Set(["Resolved", "Closed", "Wont Fix"]);
