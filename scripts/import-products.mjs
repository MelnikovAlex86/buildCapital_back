import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';

const UNIT = {
  шт: 'PCS',
  кг: 'KG',
  м3: 'M3',
  'м³': 'M3',
  л: 'L',
  м: 'M',
  м2: 'M2',
  'м²': 'M2',
  упак: 'PACK',
  набор: 'SET',
  т: 'TON',
  компл: 'KIT',
  час: 'HOUR',
  кор: 'BOX',
  поддон: 'PALLET',
  лист: 'SHEET',
};

function titleKey(title) {
  return title.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
}

const raw = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const byKey = new Map();
const notes = [];

for (const row of raw) {
  const title = String(row.title ?? '').trim().replace(/\s+/g, ' ');
  if (!title) {
    continue;
  }
  const unitText = String(row.unit ?? '').trim().toLowerCase();
  const unit = UNIT[unitText] ?? 'PCS';
  if (!UNIT[unitText]) {
    notes.push(`Единица «${row.unit ?? ''}» у «${title}» записана как шт`);
  }
  const priceText = row.price == null ? '' : String(row.price).trim().replace(',', '.');
  const unitPrice = priceText === '' ? null : priceText;
  const key = titleKey(title);
  if (byKey.has(key)) {
    notes.push(`Повтор «${title}»: оставлена цена ${unitPrice ?? 'без цены'}`);
  }
  byKey.set(key, { title, unit, unitPrice });
}

const prisma = new PrismaClient();

try {
  const admin = await prisma.user.findFirst({
    where: { role: 'ADMIN' },
    orderBy: { createdAt: 'asc' },
  });
  if (!admin) {
    throw new Error('В базе нет администратора');
  }

  const removedOrders = await prisma.order.deleteMany();
  const removedItems = await prisma.catalogItem.deleteMany();
  await prisma.catalogItem.createMany({
    data: [...byKey.values()].map((item) => ({
      title: item.title,
      titleKey: titleKey(item.title),
      unit: item.unit,
      unitPrice: item.unitPrice,
      status: 'APPROVED',
      createdById: admin.id,
      approvedAt: new Date(),
    })),
  });

  const count = await prisma.catalogItem.count();
  const users = await prisma.user.count();
  const orders = await prisma.order.count();
  console.log(
    JSON.stringify(
      {
        removedOrders: removedOrders.count,
        removedItems: removedItems.count,
        imported: count,
        users,
        orders,
        notes,
      },
      null,
      2,
    ),
  );
} finally {
  await prisma.$disconnect();
}
