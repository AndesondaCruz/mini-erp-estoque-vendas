import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateUserDto } from './create-user.dto.js';

/**
 * Todos os campos são opcionais. A senha fica de fora de propósito:
 * cada usuário troca a própria em PATCH /auth/me/password.
 */
export class UpdateUserDto extends PartialType(
  OmitType(CreateUserDto, ['password'] as const),
) {
  @ApiPropertyOptional({ description: 'false desativa o usuário' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
