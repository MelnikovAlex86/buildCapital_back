import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
  Body,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AppendOrderDto, CreateOrderDto } from './dto/create-order.dto';
import { SetLinePriceDto } from './dto/set-line-price.dto';
import { OrdersService } from './orders.service';

@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.ordersService.list(user);
  }

  @Post()
  @Roles(Role.ADMIN, Role.CUSTOMER)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrderDto) {
    return this.ordersService.create(user, dto);
  }

  @Post(':id/append')
  @Roles(Role.ADMIN, Role.CUSTOMER)
  append(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AppendOrderDto,
  ) {
    return this.ordersService.append(user, id, dto);
  }

  @Patch('lines/:lineId/complete')
  @Roles(Role.ADMIN, Role.EXECUTOR)
  complete(
    @CurrentUser() user: AuthUser,
    @Param('lineId', ParseUUIDPipe) lineId: string,
  ) {
    return this.ordersService.complete(user, lineId);
  }

  @Patch('lines/:lineId/price')
  @Roles(Role.ADMIN)
  setLinePrice(
    @CurrentUser() user: AuthUser,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body() dto: SetLinePriceDto,
  ) {
    return this.ordersService.setLinePrice(user, lineId, dto.unitPrice);
  }

  @Patch(':id/complete')
  @Roles(Role.ADMIN, Role.EXECUTOR)
  completeOrder(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ordersService.completeOrder(user, id);
  }

  @Get(':id/pdf')
  pdf(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.pdf(user, id);
  }
}
