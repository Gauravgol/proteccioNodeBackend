/*
  Warnings:

  - Added the required column `fileType` to the `Dataset` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Dataset" ADD COLUMN     "fileType" TEXT NOT NULL,
ALTER COLUMN "qualityScore" DROP NOT NULL,
ALTER COLUMN "qualityScore" DROP DEFAULT,
ALTER COLUMN "trustScore" DROP NOT NULL,
ALTER COLUMN "trustScore" DROP DEFAULT,
ALTER COLUMN "valueScore" DROP NOT NULL,
ALTER COLUMN "valueScore" DROP DEFAULT;
