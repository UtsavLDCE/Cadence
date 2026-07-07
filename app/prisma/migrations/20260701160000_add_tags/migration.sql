-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateTable (implicit many-to-many join: A = DailyTask, B = Tag)
CREATE TABLE "_DailyTaskToTag" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_DailyTaskToTag_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_DailyTaskToTag_B_index" ON "_DailyTaskToTag"("B");

-- AddForeignKey
ALTER TABLE "_DailyTaskToTag" ADD CONSTRAINT "_DailyTaskToTag_A_fkey" FOREIGN KEY ("A") REFERENCES "DailyTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DailyTaskToTag" ADD CONSTRAINT "_DailyTaskToTag_B_fkey" FOREIGN KEY ("B") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
