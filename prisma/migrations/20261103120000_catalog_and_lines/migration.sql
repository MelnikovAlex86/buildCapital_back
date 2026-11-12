-- CreateEnum
CREATE TYPE "Unit" AS ENUM ('KG', 'PCS', 'M3', 'L');

-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('PENDING', 'APPROVED');

-- CreateTable
CREATE TABLE "CatalogItem" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "titleKey" TEXT NOT NULL,
    "unit" "Unit" NOT NULL,
    "unitPrice" DECIMAL(12,2),
    "status" "ItemStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,

    CONSTRAINT "CatalogItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLine" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "unit" "Unit" NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unitPrice" DECIMAL(12,2),
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "orderId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "completedById" TEXT,

    CONSTRAINT "OrderLine_pkey" PRIMARY KEY ("id")
);

-- Move existing flat orders into a catalog item and a line.
INSERT INTO "CatalogItem" ("id", "title", "titleKey", "unit", "unitPrice", "status", "createdAt", "approvedAt", "createdById")
SELECT DISTINCT ON (lower(trim("title")))
    gen_random_uuid()::text,
    trim("title"),
    lower(trim("title")),
    'PCS'::"Unit",
    "unitPrice",
    'APPROVED'::"ItemStatus",
    "createdAt",
    "createdAt",
    "authorId"
FROM "Order"
ORDER BY lower(trim("title")), "createdAt";

INSERT INTO "OrderLine" ("id", "title", "unit", "quantity", "unitPrice", "completed", "completedAt", "orderId", "itemId", "completedById")
SELECT
    gen_random_uuid()::text,
    trim(o."title"),
    'PCS'::"Unit",
    o."quantity",
    CASE WHEN o."completed" THEN o."unitPrice" ELSE NULL END,
    o."completed",
    o."completedAt",
    o."id",
    c."id",
    o."completedById"
FROM "Order" o
JOIN "CatalogItem" c ON c."titleKey" = lower(trim(o."title"));

-- AlterTable
ALTER TABLE "Order" DROP CONSTRAINT "Order_completedById_fkey";

ALTER TABLE "Order"
DROP COLUMN "title",
DROP COLUMN "quantity",
DROP COLUMN "completed",
DROP COLUMN "unitPrice",
DROP COLUMN "totalPrice",
DROP COLUMN "completedAt",
DROP COLUMN "completedById";

-- CreateIndex
CREATE UNIQUE INDEX "CatalogItem_titleKey_key" ON "CatalogItem"("titleKey");

-- CreateIndex
CREATE INDEX "CatalogItem_status_idx" ON "CatalogItem"("status");

-- CreateIndex
CREATE INDEX "OrderLine_orderId_idx" ON "OrderLine"("orderId");

-- AddForeignKey
ALTER TABLE "CatalogItem" ADD CONSTRAINT "CatalogItem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
