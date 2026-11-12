import { Type } from 'class-transformer';
import { IsEnum, IsNumber, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { Unit } from '@prisma/client';

export class CreateCatalogItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  title!: string;

  @IsEnum(Unit)
  unit!: Unit;
}

export class SetItemPriceDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unitPrice!: number;
}
