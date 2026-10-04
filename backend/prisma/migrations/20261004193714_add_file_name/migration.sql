/*
  Warnings:

  - Added the required column `name` to the `File` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "File" ADD COLUMN "name" TEXT;
UPDATE "File" SET "name" = "filename";
ALTER TABLE "File" ALTER COLUMN "name" SET NOT NULL;
