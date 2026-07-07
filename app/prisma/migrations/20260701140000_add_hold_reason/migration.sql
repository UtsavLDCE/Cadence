-- Capture why a task was put on HOLD and who/which team it's waiting on.
-- Populated only on transitions to HOLD; null otherwise. `blockedOn` powers the
-- cross-team-dependency leak signal on /insights.
ALTER TABLE "TaskStatusEvent" ADD COLUMN "note" TEXT;
ALTER TABLE "TaskStatusEvent" ADD COLUMN "blockedOn" TEXT;
