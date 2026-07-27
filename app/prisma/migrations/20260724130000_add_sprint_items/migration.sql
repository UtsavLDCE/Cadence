-- Sprint import: work items from the external sprint tool (Azure DevOps CSV export).
-- Upserted per (version, externalId); assignee matched to a Cadence user by email
-- local-part. currentSprintVersion on AppSettings picks the active sprint.

ALTER TABLE "AppSettings" ADD COLUMN "currentSprintVersion" TEXT;

CREATE TABLE "SprintItem" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "workItemType" TEXT,
    "state" TEXT,
    "title" TEXT NOT NULL,
    "assigneeRaw" TEXT,
    "assigneeLogin" TEXT,
    "userId" TEXT,
    "tags" TEXT,
    "storySize" TEXT,
    "estimate" TEXT,
    "priority" TEXT,
    "createdBy" TEXT,
    "startDate" DATE,
    "devCompletionDate" DATE,
    "dueDate" DATE,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SprintItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SprintItem_version_externalId_key" ON "SprintItem"("version", "externalId");
CREATE INDEX "SprintItem_userId_idx" ON "SprintItem"("userId");
CREATE INDEX "SprintItem_version_idx" ON "SprintItem"("version");

ALTER TABLE "SprintItem" ADD CONSTRAINT "SprintItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
