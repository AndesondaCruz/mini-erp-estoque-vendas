import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  PASSWORD_MAX,
  PASSWORD_MIN,
} from '../../auth/dto/change-password.dto.js';
import { Role } from '../../generated/prisma/enums.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateUserDto {
  @ApiProperty({ example: 'Maria Souza', maxLength: 120 })
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'nome é obrigatório' })
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'maria@loja.com' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'email inválido' })
  @MaxLength(254)
  email!: string;

  @ApiProperty({ minLength: PASSWORD_MIN, maxLength: PASSWORD_MAX })
  @IsString()
  @MinLength(PASSWORD_MIN, {
    message: `a senha deve ter pelo menos ${PASSWORD_MIN} caracteres`,
  })
  @MaxLength(PASSWORD_MAX)
  password!: string;

  @ApiProperty({ enum: Role })
  @IsEnum(Role, { message: 'role deve ser ADMIN, GERENTE ou VENDEDOR' })
  role!: Role;
}
