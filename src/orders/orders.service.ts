import {
  BadRequestException,
  Injectable,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { AuthUser } from '../auth/auth-user';
import { CatalogService } from '../catalog/catalog.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { AppendOrderDto, CreateOrderDto, CreateOrderLineDto } from './dto/create-order.dto';
import { OrderPdfInput, renderOrderPdf } from './order-pdf';
import { currentWeek, formatStamp, inCurrentWeek, projectKey } from './week';

const orderInclude = {
  author: { select: { id: true, name: true } },
  parts: {
    orderBy: { createdAt: 'asc' as const },
    include: {
      author: { select: { id: true, name: true } },
      lines: { orderBy: { title: 'asc' as const } },
    },
  },
} satisfies Prisma.OrderInclude;

type OrderRecord = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;
type Db = Prisma.TransactionClient;

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(user: AuthUser) {
    const orders = await this.prisma.order.findMany({
      where:
        user.role === Role.CUSTOMER
          ? {
              OR: [
                { authorId: user.id },
                { parts: { some: { authorId: user.id } } },
              ],
            }
          : undefined,
      include: orderInclude,
      orderBy: { createdAt: 'desc' },
    });
    return orders.map((order) => this.toView(order, user.role));
  }

  async create(user: AuthUser, dto: CreateOrderDto) {
    const existingId = await this.findCurrentOrder(dto.project);
    if (existingId) {
      const order = await this.appendLines(user, existingId, dto.lines);
      return { ...order, appended: true };
    }

    const orderId = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          project: dto.project.trim().replace(/\s+/g, ' '),
          authorId: user.id,
        },
      });
      await this.addPart(tx, order.id, user, dto.lines);
      return order.id;
    });

    const order = await this.load(orderId);
    await this.notifications.notifyNewOrder(order.id, user.id);
    return { ...this.toView(order, user.role), appended: false };
  }

  async append(user: AuthUser, orderId: string, dto: AppendOrderDto) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException('Заявка не найдена');
    }
    if (!inCurrentWeek(order.createdAt)) {
      throw new BadRequestException(
        'Дополнить можно только заявку текущей недели, с понедельника по воскресенье',
      );
    }
    return this.appendLines(user, order.id, dto.lines);
  }

  async complete(user: AuthUser, lineId: string) {
    const line = await this.prisma.orderLine.findUnique({
      where: { id: lineId },
    });
    if (!line) {
      throw new NotFoundException('Позиция не найдена');
    }

    const wasOpen = !line.completed;
    if (wasOpen) {
      await this.prisma.orderLine.update({
        where: { id: lineId },
        data: {
          completed: true,
          completedAt: new Date(),
          completedById: user.id,
        },
      });
      await this.notifyIfFullyDone(line.orderId, user.id);
    }

    const order = await this.load(line.orderId);
    return this.toView(order, user.role);
  }

  async completeOrder(user: AuthUser, orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { lines: true },
    });
    if (!order) {
      throw new NotFoundException('Заявка не найдена');
    }

    const openLines = order.lines.filter((line) => !line.completed);
    if (openLines.length > 0) {
      await this.prisma.orderLine.updateMany({
        where: { orderId, completed: false },
        data: {
          completed: true,
          completedAt: new Date(),
          completedById: user.id,
        },
      });
      await this.notifications.notifyOrderCompleted(order.id, user.id);
    }

    const updated = await this.load(orderId);
    return this.toView(updated, user.role);
  }

  async setLinePrice(user: AuthUser, lineId: string, unitPrice: number) {
    const line = await this.prisma.orderLine.findUnique({ where: { id: lineId } });
    if (!line) {
      throw new NotFoundException('Позиция не найдена');
    }
    await this.prisma.orderLine.update({
      where: { id: lineId },
      data: { unitPrice: new Prisma.Decimal(unitPrice) },
    });
    const order = await this.load(line.orderId);
    return this.toView(order, user.role);
  }

  async pdf(user: AuthUser, orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: orderInclude,
    });
    if (!order || !this.canSee(user, order)) {
      throw new NotFoundException('Заявка не найдена');
    }

    const buffer = await renderOrderPdf(this.toPdfInput(order));
    const filename = encodeURIComponent(`Заявка ${order.project}.pdf`);
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `attachment; filename="order.pdf"; filename*=UTF-8''${filename}`,
    });
  }

  private async appendLines(
    user: AuthUser,
    orderId: string,
    lines: CreateOrderLineDto[],
  ) {
    await this.prisma.$transaction((tx) => this.addPart(tx, orderId, user, lines));
    const order = await this.load(orderId);
    await this.notifications.notifyOrderUpdated(order.id, user.id);
    return this.toView(order, user.role);
  }

  private async addPart(
    tx: Db,
    orderId: string,
    user: AuthUser,
    lines: CreateOrderLineDto[],
  ) {
    const part = await tx.orderPart.create({
      data: { orderId, authorId: user.id },
    });
    for (const line of lines) {
      const item = await this.catalog.resolveForOrder(tx, user, line);
      await tx.orderLine.create({
        data: {
          orderId,
          partId: part.id,
          itemId: item.id,
          title: item.title,
          unit: item.unit,
          quantity: new Prisma.Decimal(line.quantity),
          unitPrice: item.unitPrice,
        },
      });
    }
  }

  private async findCurrentOrder(project: string) {
    const week = currentWeek();
    const key = projectKey(project);
    const orders = await this.prisma.order.findMany({
      where: { createdAt: { gte: week.start, lt: week.end } },
      select: { id: true, project: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    return orders.find((order) => projectKey(order.project) === key)?.id;
  }

  private load(id: string) {
    return this.prisma.order.findUniqueOrThrow({
      where: { id },
      include: orderInclude,
    });
  }

  private canSee(user: AuthUser, order: OrderRecord) {
    if (user.role !== Role.CUSTOMER) {
      return true;
    }
    return (
      order.authorId === user.id ||
      order.parts.some((part) => part.authorId === user.id)
    );
  }

  private async notifyIfFullyDone(orderId: string, actorId: string) {
    const openCount = await this.prisma.orderLine.count({
      where: { orderId, completed: false },
    });
    if (openCount === 0) {
      await this.notifications.notifyOrderCompleted(orderId, actorId);
    }
  }

  private toPdfInput(order: OrderRecord): OrderPdfInput {
    return {
      project: order.project,
      sections: order.parts.map((part, index) => ({
        authorName: part.author.name,
        createdAtLabel: formatStamp(index === 0 ? order.createdAt : part.createdAt),
        lines: part.lines.map((line) => ({
          title: line.title,
          quantity: line.quantity.toString(),
          unit: line.unit,
        })),
      })),
    };
  }

  private toLine(
    line: OrderRecord['parts'][number]['lines'][number],
    role: Role,
  ) {
    const base = {
      id: line.id,
      title: line.title,
      unit: line.unit,
      quantity: line.quantity.toString(),
      completed: line.completed,
    };
    if (role === Role.CUSTOMER) {
      return base;
    }
    return {
      ...base,
      unitPrice: line.unitPrice?.toFixed(2) ?? null,
      totalPrice: line.unitPrice
        ? line.quantity.mul(line.unitPrice).toDecimalPlaces(2).toFixed(2)
        : null,
    };
  }

  private toView(order: OrderRecord, role: Role) {
    const parts = order.parts.map((part) => ({
      id: part.id,
      createdAt: part.createdAt,
      author: part.author,
      lines: part.lines.map((line) => this.toLine(line, role)),
    }));
    return {
      id: order.id,
      project: order.project,
      createdAt: order.createdAt,
      author: order.author,
      canAppend:
        (role === Role.ADMIN || role === Role.CUSTOMER) &&
        inCurrentWeek(order.createdAt),
      parts,
      lines: parts.flatMap((part) => part.lines),
    };
  }
}
