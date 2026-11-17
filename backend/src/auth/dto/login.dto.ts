import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'admin@mini-erp.local' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'email inválido' })
  @MaxLength(254)
  email!: string;

  // Sem regra de tamanho mínimo aqui: o login só confere a senha.
  // O limite máximo evita gastar CPU com hash de textos gigantes.
  @ApiProperty({ example: 'senha-de-exemplo' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}
