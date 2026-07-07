-- Task categorization. A user-extensible lookup table (Meeting, Client Call,
-- Cross-Team, R&D, …) plus an optional FK on DailyTask. Global/team-wide so the
-- /insights "where time goes" roll-up aggregates cleanly. Seeded with a default
-- set; users add more from the task forms.

CREATE TABLE "TaskCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskCategory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TaskCategory_name_key" ON "TaskCategory"("name");
CREATE INDEX "TaskCategory_sortOrder_idx" ON "TaskCategory"("sortOrder");

-- Optional category on each daily task. Nullable so existing rows stay
-- uncategorized; SetNull keeps rows intact if a category is ever deleted.
ALTER TABLE "DailyTask" ADD COLUMN "categoryId" TEXT;
CREATE INDEX "DailyTask_categoryId_idx" ON "DailyTask"("categoryId");
ALTER TABLE "DailyTask"
    ADD CONSTRAINT "DailyTask_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "TaskCategory"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed the default vocabulary. Fixed, readable ids so they're stable across
-- environments. "CROSS_TEAM" groups the three cross-team variants in the UI.
INSERT INTO "TaskCategory" ("id", "name", "kind", "isDefault", "sortOrder") VALUES
    ('cat_development',   'Development',          NULL,         true, 0),
    ('cat_meeting',       'Meeting',              NULL,         true, 1),
    ('cat_discussion',    'Discussion',           NULL,         true, 2),
    ('cat_client_call',   'Client Call',          NULL,         true, 3),
    ('cat_ct_support',    'Cross-Team: Support',  'CROSS_TEAM', true, 4),
    ('cat_ct_delivery',   'Cross-Team: Delivery', 'CROSS_TEAM', true, 5),
    ('cat_ct_pmg',        'Cross-Team: PMG',      'CROSS_TEAM', true, 6),
    ('cat_rnd',           'R&D',                  NULL,         true, 7);
