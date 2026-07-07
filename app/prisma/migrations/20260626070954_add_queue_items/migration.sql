-- CreateTable
CREATE TABLE "QueueItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "estimatedHours" DOUBLE PRECISION,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QueueItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QueueItem_userId_position_idx" ON "QueueItem"("userId", "position");

-- AddForeignKey
ALTER TABLE "QueueItem" ADD CONSTRAINT "QueueItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
