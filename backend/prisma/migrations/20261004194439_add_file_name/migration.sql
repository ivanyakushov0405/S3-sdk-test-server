/*
  Warnings:

  - You are about to alter the column `name` on the `File` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(16)`.

*/
-- AlterTable
ALTER TABLE "File" ALTER COLUMN "name" SET DATA TYPE VARCHAR(16);
