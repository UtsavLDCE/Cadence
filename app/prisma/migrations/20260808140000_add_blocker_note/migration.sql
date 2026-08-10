-- Free-text remark on the cross-person dependency: what exactly is being
-- waited on. Set/cleared together with blockedOnUserId.
ALTER TABLE "DailyTask" ADD COLUMN "blockedOnNote" TEXT;
