import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ItemStatus, Prisma, Role, Unit } from '@prisma/client';
import { AuthUser } from '../auth/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCatalogItemDto } from './dto/catalog.dto';

const itemInclude = {
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.CatalogItemInclude;

export type CatalogRecord = Prisma.CatalogItemGetPayload<{
  include: typeof itemInclude;
}>;

type Db = Prisma.TransactionClient | PrismaService;

export function normalizeTitle(title: string) {
  return title.trim().replace(/\s+/g, ' ');
}

export function titleKeyOf(title: string) {
  return normalizeTitle(title).toLocaleLowerCase('ru-RU');
}

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser) {
    const items = await this.prisma.catalogItem.findMany({
      where:
        user.role === Role.ADMIN
          ? undefined
          : {
              OR: [
                { status: ItemStatus.APPROVED },
                { createdById: user.id },
              ],
            },
      include: itemInclude,
      orderBy: [{ status: 'asc' }, { title: 'asc' }],
    });
    return items.map((item) => this.toView(item, user.role));
  }

  async create(user: AuthUser, dto: CreateCatalogItemDto) {
    const title = normalizeTitle(dto.title);
    const existing = await this.prisma.catalogItem.findUnique({
      where: { titleKey: titleKeyOf(title) },
      include: itemInclude,
    });
    if (existing) {
      this.throwIfTaken(existing, dto.unit);
    }
    const item = await this.insertItem(this.prisma, user, title, dto.unit);
    return this.toView(item, user.role);
  }

  async approve(id: string, user: AuthUser) {
    await this.findOrThrow(id);
    const item = await this.prisma.catalogItem.update({
      where: { id },
      data: { status: ItemStatus.APPROVED, approvedAt: new Date() },
      include: itemInclude,
    });
    return this.toView(item, user.role);
  }

  async setPrice(id: string, unitPrice: number, user: AuthUser) {
    const existing = await this.findOrThrow(id);
    if (existing.status !== ItemStatus.APPROVED) {
      throw new ConflictException('Сначала подтвердите наименование');
    }
    const item = await this.prisma.catalogItem.update({
      where: { id },
      data: { unitPrice: new Prisma.Decimal(unitPrice) },
      include: itemInclude,
    });
    return this.toView(item, user.role);
  }

  async resolveForOrder(
    db: Db,
    user: AuthUser,
    input: { itemId?: string; title?: string; unit?: Unit },
  ) {
    if (input.itemId) {
      const item = await db.catalogItem.findUnique({
        where: { id: input.itemId },
        include: itemInclude,
      });
      if (!item) {
        throw new NotFoundException('Наименование не найдено');
      }
      this.assertVisible(item, user);
      return item;
    }

    if (!input.title || !input.unit) {
      throw new ConflictException('Укажите наименование и единицу измерения');
    }

    const title = normalizeTitle(input.title);
    const existing = await db.catalogItem.findUnique({
      where: { titleKey: titleKeyOf(title) },
      include: itemInclude,
    });
    if (existing) {
      if (existing.unit !== input.unit) {
        throw new ConflictException(
          `«${existing.title}» уже есть, единица измерения — другая`,
        );
      }
      this.assertVisible(existing, user);
      return existing;
    }
    return this.insertItem(db, user, title, input.unit);
  }

  private insertItem(db: Db, user: AuthUser, title: string, unit: Unit) {
    const approved = user.role === Role.ADMIN;
    return db.catalogItem.create({
      data: {
        title,
        titleKey: titleKeyOf(title),
        unit,
        status: approved ? ItemStatus.APPROVED : ItemStatus.PENDING,
        approvedAt: approved ? new Date() : null,
        createdById: user.id,
      },
      include: itemInclude,
    });
  }

  private throwIfTaken(existing: CatalogRecord, unit: Unit) {
    if (existing.unit !== unit) {
      throw new ConflictException(
        `«${existing.title}» уже есть, единица измерения — другая`,
      );
    }
    if (existing.status === ItemStatus.APPROVED) {
      throw new ConflictException(`«${existing.title}» уже есть в списке`);
    }
    throw new ConflictException(`«${existing.title}» уже ждёт согласования`);
  }

  private assertVisible(item: CatalogRecord, user: AuthUser) {
    if (user.role === Role.ADMIN || item.status === ItemStatus.APPROVED) {
      return;
    }
    if (item.createdById !== user.id) {
      throw new ConflictException(
        'Такое наименование уже предложено и ждёт согласования',
      );
    }
  }

  private async findOrThrow(id: string) {
    const item = await this.prisma.catalogItem.findUnique({ where: { id } });
    if (!item) {
      throw new NotFoundException('Наименование не найдено');
    }
    return item;
  }

  toView(item: CatalogRecord, role: Role) {
    const base = {
      id: item.id,
      title: item.title,
      unit: item.unit,
      status: item.status,
      createdAt: item.createdAt,
      createdBy: item.createdBy,
    };
    if (role === Role.CUSTOMER) {
      return base;
    }
    return {
      ...base,
      unitPrice: item.unitPrice?.toFixed(2) ?? null,
    };
  }
}
