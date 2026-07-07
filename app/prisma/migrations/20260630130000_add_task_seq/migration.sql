-- Add a human-friendly sequential identifier to DailyTask, surfaced as "Task-{seq}".
-- Existing rows are backfilled in creation order so Task-1 is the oldest task.

ALTER TABLE "DailyTask" ADD COLUMN "seq" INTEGER;

WITH ordered AS (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, "id" ASC) AS rn
  FROM "DailyTask"
)
UPDATE "DailyTask" t SET "seq" = o.rn FROM ordered o WHERE t."id" = o."id";

CREATE SEQUENCE "DailyTask_seq_seq" OWNED BY "DailyTask"."seq";
SELECT setval('"DailyTask_seq_seq"', COALESCE((SELECT MAX("seq") FROM "DailyTask"), 0) + 1, false);
ALTER TABLE "DailyTask" ALTER COLUMN "seq" SET DEFAULT nextval('"DailyTask_seq_seq"');
ALTER TABLE "DailyTask" ALTER COLUMN "seq" SET NOT NULL;

CREATE UNIQUE INDEX "DailyTask_seq_key" ON "DailyTask"("seq");
