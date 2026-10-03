/*
  Warnings:

  - A unique constraint covering the columns `[storageKey]` on the table `File` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "File_storageKey_key" ON "File"("storageKey");
