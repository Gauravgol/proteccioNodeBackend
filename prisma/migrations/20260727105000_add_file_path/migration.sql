-- Add filePath with a default so existing datasets remain valid.
ALTER TABLE "Dataset" ADD COLUMN "filePath" TEXT NOT NULL DEFAULT '';
