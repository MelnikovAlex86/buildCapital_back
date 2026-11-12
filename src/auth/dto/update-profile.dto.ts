import { IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @ValidateIf((_, value) => value != null && value !== '')
  @IsString()
  @Matches(/^[0-9+()\-\s]{6,30}$/, { message: 'Некорректный номер телефона' })
  phone?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value != null && value !== '')
  @IsString()
  @MaxLength(200)
  telegram?: string | null;
}
