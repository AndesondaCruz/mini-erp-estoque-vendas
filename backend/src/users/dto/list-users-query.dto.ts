import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination.js';
import { Role } from '../../generated/prisma/enums.js';

// Lista de campos PERMITIDOS para ordenar. O valor vindo da URL nunca vira
// nome de coluna diretamente: só passa se estiver aqui.
export const USER_SORT_FIELDS = ['name', 'email', 'role', 'createdAt'] as const;
export type UserSortField = (typeof USER_SORT_FIELDS)[number];

export class ListUsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Busca por nome ou e-mail' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: Role })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  // Na query string tudo é texto: só "true" e "false" viram booleanos.
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean({ message: 'active deve ser true ou false' })
  active?: boolean;

  @ApiPropertyOptional({ enum: USER_SORT_FIELDS, default: 'name' })
  @IsOptional()
  @IsIn(USER_SORT_FIELDS)
  sort: UserSortField = 'name';
}
