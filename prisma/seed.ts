import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('12345678', 10);
  await prisma.user.upsert({
    where: { email: 'melnikovaleksey97@yandex.ru' },
    update: {
      name: 'Администратор',
      passwordHash,
      role: Role.ADMIN,
    },
    create: {
      name: 'Администратор',
      email: 'melnikovaleksey97@yandex.ru',
      passwordHash,
      role: Role.ADMIN,
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
