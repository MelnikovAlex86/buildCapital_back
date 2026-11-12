import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { renderOrderPdf } from '../orders/order-pdf';
import { formatStamp } from '../orders/week';

type TgMessage = {
  text?: string;
  chat: { id: number; type: string };
  from?: { username?: string };
};

type TgUpdate = {
  update_id: number;
  message?: TgMessage;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function telegramUsername(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const cleaned = value
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^(t\.me|telegram\.me)\//i, '')
    .replace(/^@/, '')
    .split(/[/?#]/)[0];
  if (!/^[a-zA-Z0-9_]{5,32}$/.test(cleaned)) {
    return null;
  }
  return cleaned.toLowerCase();
}

function pdfFilename(project: string) {
  const clean = project.replace(/[\\/:*?"<>|\n\r]/g, ' ').trim().slice(0, 80);
  return `Заявка ${clean || 'order'}.pdf`;
}

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);
  private readonly token: string;
  private readonly abort = new AbortController();
  private offset = 0;
  private stopped = false;
  private botUsername: string | null = null;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.token = config.get<string>('TELEGRAM_BOT_TOKEN')?.trim() ?? '';
  }

  async onModuleInit() {
    if (!this.token) {
      this.logger.warn(
        'TELEGRAM_BOT_TOKEN не задан, уведомления в Telegram отключены',
      );
      return;
    }
    try {
      await this.call('deleteWebhook', { drop_pending_updates: false });
      const me = await this.call<{ username?: string }>('getMe');
      this.botUsername = me.username ?? null;
      await this.call('setMyCommands', {
        commands: [{ command: 'start', description: 'Подключить уведомления' }],
      });
      this.logger.log(
        `Telegram-бот @${this.botUsername ?? 'unknown'} запущен`,
      );
      void this.poll();
    } catch (error) {
      this.logger.error(`Не удалось запустить Telegram-бота: ${this.errorText(error)}`);
    }
  }

  onModuleDestroy() {
    this.stopped = true;
    this.abort.abort();
  }

  async status(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { telegramChatId: true },
    });
    return {
      enabled: Boolean(this.token),
      linked: Boolean(user?.telegramChatId),
      username: this.botUsername,
      url: this.botUsername
        ? `https://t.me/${this.botUsername}?start=${userId}`
        : null,
    };
  }

  notifyNewOrder(orderId: string, authorId: string) {
    return this.sendOrderPdf(orderId, authorId, 'Новая заявка');
  }

  notifyOrderUpdated(orderId: string, actorId: string) {
    return this.sendOrderPdf(orderId, actorId, 'Заявка дополнена');
  }

  private async sendOrderPdf(orderId: string, actorId: string, title: string) {
    if (!this.token) {
      return;
    }
    try {
      const recipients = await this.prisma.user.findMany({
        where: {
          role: { in: [Role.ADMIN, Role.EXECUTOR] },
          id: { not: actorId },
          telegramChatId: { not: null },
        },
        select: { telegramChatId: true },
      });
      const chatIds = recipients
        .map((recipient) => recipient.telegramChatId)
        .filter((chatId): chatId is string => Boolean(chatId));
      if (chatIds.length === 0) {
        return;
      }

      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: {
          parts: {
            orderBy: { createdAt: 'asc' },
            include: {
              author: { select: { name: true } },
              lines: { orderBy: { title: 'asc' } },
            },
          },
        },
      });
      if (!order || order.parts.length === 0) {
        return;
      }

      const latest = order.parts[order.parts.length - 1];
      const pdf = await renderOrderPdf({
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
      });
      const caption = [
        title,
        `Объект: ${order.project}`,
        `От: ${latest.author.name}`,
        `Дата: ${formatStamp(latest.createdAt)}`,
      ].join('\n');

      const filename = pdfFilename(order.project);
      await Promise.all(
        chatIds.map(async (chatId) => {
          try {
            await this.sendDocument(chatId, pdf, filename, caption);
          } catch (error) {
            this.logger.error(
              `Не удалось отправить заявку ${order.id} в чат ${chatId}: ${this.errorText(error)}`,
            );
          }
        }),
      );
    } catch (error) {
      this.logger.error(
        `Не удалось подготовить уведомление о заявке ${orderId}: ${this.errorText(error)}`,
      );
    }
  }

  private async poll() {
    while (!this.stopped) {
      try {
        const updates = await this.call<TgUpdate[]>('getUpdates', {
          timeout: 25,
          offset: this.offset,
          allowed_updates: ['message'],
        });
        for (const update of updates) {
          this.offset = update.update_id + 1;
          if (update.message) {
            await this.handleMessage(update.message);
          }
        }
      } catch (error) {
        if (this.stopped) {
          return;
        }
        this.logger.warn(`Опрос Telegram прерван: ${this.errorText(error)}`);
        await this.sleep(3000);
      }
    }
  }

  private async handleMessage(message: TgMessage) {
    if (message.chat.type !== 'private') {
      return;
    }
    const text = message.text?.trim() ?? '';
    const command = text.split(/\s+/)[0]?.split('@')[0];
    if (command !== '/start') {
      await this.sendMessage(
        message.chat.id,
        'Напишите /start или откройте бота по ссылке из профиля в приложении.',
      );
      return;
    }

    const payload = text.split(/\s+/).slice(1).join(' ').trim();
    const chatId = String(message.chat.id);
    const user = await this.resolveUser(payload, message.from?.username);
    if (!user) {
      await this.sendMessage(
        message.chat.id,
        'Не удалось привязать аккаунт. Откройте бота по ссылке из раздела «Контакты» в приложении.',
      );
      return;
    }

    await this.prisma.user.updateMany({
      where: { telegramChatId: chatId, NOT: { id: user.id } },
      data: { telegramChatId: null },
    });
    await this.prisma.user.update({
      where: { id: user.id },
      data: { telegramChatId: chatId },
    });

    const note =
      user.role === Role.ADMIN || user.role === Role.EXECUTOR
        ? 'Сюда будут приходить новые заявки и PDF.'
        : 'Аккаунт привязан. Уведомления о новых заявках получают администраторы и исполнители.';
    await this.sendMessage(message.chat.id, `Готово, ${user.name}. ${note}`);
  }

  private async resolveUser(payload: string, username: string | undefined) {
    if (UUID_RE.test(payload)) {
      const byId = await this.prisma.user.findUnique({ where: { id: payload } });
      if (byId) {
        return byId;
      }
    }

    const normalized = telegramUsername(username ? `@${username}` : null);
    if (!normalized) {
      return null;
    }
    const candidates = await this.prisma.user.findMany({
      where: { telegram: { not: null } },
    });
    const matches = candidates.filter(
      (candidate) => telegramUsername(candidate.telegram) === normalized,
    );
    return matches.length === 1 ? matches[0] : null;
  }

  private async sendMessage(chatId: number | string, text: string) {
    await this.call('sendMessage', { chat_id: chatId, text });
  }

  private async sendDocument(
    chatId: string,
    pdf: Buffer,
    filename: string,
    caption: string,
  ) {
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('caption', caption.slice(0, 1024));
    form.append(
      'document',
      new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }),
      filename,
    );
    const response = await this.fetchWithTimeout(`${this.api()}/sendDocument`, {
      method: 'POST',
      body: form,
    });
    const payload = (await response.json()) as {
      ok: boolean;
      description?: string;
    };
    if (!payload.ok) {
      throw new Error(payload.description ?? 'sendDocument failed');
    }
  }

  private api() {
    return `https://api.telegram.org/bot${this.token}`;
  }

  private async call<T>(method: string, body?: Record<string, unknown>) {
    const response = await this.fetchWithTimeout(
      `${this.api()}/${method}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      },
      method === 'getUpdates' ? 40_000 : 20_000,
    );
    const payload = (await response.json()) as {
      ok: boolean;
      description?: string;
      result: T;
    };
    if (!payload.ok) {
      throw new Error(payload.description ?? method);
    }
    return payload.result;
  }

  private fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 20_000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onStop = () => controller.abort();
    this.abort.signal.addEventListener('abort', onStop);
    return fetch(url, { ...init, signal: controller.signal }).finally(() => {
      clearTimeout(timer);
      this.abort.signal.removeEventListener('abort', onStop);
    });
  }

  private errorText(error: unknown) {
    return error instanceof Error ? error.message : 'неизвестная ошибка';
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
