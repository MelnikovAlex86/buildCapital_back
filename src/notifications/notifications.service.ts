import { Injectable } from '@nestjs/common';
import { NotificationType, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from '../telegram/telegram.service';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
  ) {}

  async list(userId: string) {
    const [items, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        include: {
          order: {
            select: { id: true, project: true, author: { select: { name: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
      this.prisma.notification.count({
        where: { userId, readAt: null },
      }),
    ]);

    return {
      unreadCount,
      items: items.map((item) => ({
        id: item.id,
        type: item.type,
        read: item.readAt !== null,
        createdAt: item.createdAt,
        order: {
          id: item.order.id,
          project: item.order.project,
          authorName: item.order.author.name,
        },
      })),
    };
  }

  async markRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }

  async notifyNewOrder(orderId: string, authorId: string) {
    const recipients = await this.prisma.user.findMany({
      where: {
        role: { in: [Role.ADMIN, Role.EXECUTOR] },
        id: { not: authorId },
      },
      select: { id: true },
    });
    if (recipients.length === 0) {
      return;
    }
    await this.prisma.notification.createMany({
      data: recipients.map((recipient) => ({
        userId: recipient.id,
        orderId,
        type: NotificationType.NEW_ORDER,
      })),
    });
    await this.telegram.notifyNewOrder(orderId, authorId);
  }

  async notifyOrderUpdated(orderId: string, actorId: string) {
    const recipients = await this.prisma.user.findMany({
      where: {
        role: { in: [Role.ADMIN, Role.EXECUTOR] },
        id: { not: actorId },
      },
      select: { id: true },
    });
    if (recipients.length === 0) {
      return;
    }
    await this.prisma.notification.createMany({
      data: recipients.map((recipient) => ({
        userId: recipient.id,
        orderId,
        type: NotificationType.ORDER_UPDATED,
      })),
    });
    await this.telegram.notifyOrderUpdated(orderId, actorId);
  }

  async notifyOrderCompleted(orderId: string, actorId: string) {
    const recipients = await this.prisma.user.findMany({
      where: { role: Role.ADMIN, id: { not: actorId } },
      select: { id: true },
    });
    if (recipients.length === 0) {
      return;
    }
    await this.prisma.notification.createMany({
      data: recipients.map((recipient) => ({
        userId: recipient.id,
        orderId,
        type: NotificationType.ORDER_COMPLETED,
      })),
    });
  }
}
