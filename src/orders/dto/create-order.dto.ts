import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Unit } from '@prisma/client';

export class CreateOrderLineDto {
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @ValidateIf((line: CreateOrderLineDto) => !line.itemId)
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  title?: string;

  @ValidateIf((line: CreateOrderLineDto) => !line.itemId)
  @IsEnum(Unit)
  unit?: Unit;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  quantity!: number;
}

export class CreateOrderDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  project!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderLineDto)
  lines!: CreateOrderLineDto[];
}

export class AppendOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderLineDto)
  lines!: CreateOrderLineDto[];
}
