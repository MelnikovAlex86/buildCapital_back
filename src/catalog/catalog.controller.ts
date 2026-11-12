import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CatalogService } from './catalog.service';
import { CreateCatalogItemDto, SetItemPriceDto } from './dto/catalog.dto';

@Controller('catalog')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.catalogService.list(user);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCatalogItemDto) {
    return this.catalogService.create(user, dto);
  }

  @Patch(':id/approve')
  @Roles(Role.ADMIN)
  approve(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.catalogService.approve(id, user);
  }

  @Patch(':id/price')
  @Roles(Role.ADMIN)
  setPrice(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetItemPriceDto,
  ) {
    return this.catalogService.setPrice(id, dto.unitPrice, user);
  }
}
