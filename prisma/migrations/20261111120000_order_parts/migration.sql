CREATE TYPE "NotificationType_new" AS ENUM ('NEW_ORDER', 'ORDER_UPDATED', 'ORDER_COMPLETED');

ALTER TABLE "Notification" ALTER COLUMN "type" TYPE "NotificationType_new" USING ("type"::text::"NotificationType_new");

DROP TYPE "NotificationType";

ALTER TYPE "NotificationType_new" RENAME TO "NotificationType";

CREATE TABLE "OrderPart" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "orderId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,

    CONSTRAINT "OrderPart_pkey" PRIMARY KEY ("id")
);

INSERT INTO "OrderPart" ("id", "createdAt", "orderId", "authorId")
SELECT gen_random_uuid()::text, "createdAt", "id", "authorId"
FROM "Order";

ALTER TABLE "OrderLine" ADD COLUMN "partId" TEXT;

UPDATE "OrderLine" AS line
SET "partId" = part."id"
FROM "OrderPart" AS part
WHERE part."orderId" = line."orderId";

ALTER TABLE "OrderLine" ALTER COLUMN "partId" SET NOT NULL;

CREATE INDEX "OrderPart_orderId_idx" ON "OrderPart"("orderId");

ALTER TABLE "OrderPart" ADD CONSTRAINT "OrderPart_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrderPart" ADD CONSTRAINT "OrderPart_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_partId_fkey" FOREIGN KEY ("partId") REFERENCES "OrderPart"("id") ON DELETE CASCADE ON UPDATE CASCADE;
