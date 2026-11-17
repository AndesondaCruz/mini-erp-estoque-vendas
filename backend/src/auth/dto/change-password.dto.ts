import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

// Política de senha da NIST 800-63B: tamanho importa mais que composição.
// Sem exigir maiúscula ou símbolo, que levam a senhas previsíveis ("Senha@123").
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(PASSWORD_MAX)
  currentPassword!: string;

  @ApiProperty({ minLength: PASSWORD_MIN, maxLength: PASSWORD_MAX })
  @IsString()
  @MinLength(PASSWORD_MIN, {
    message: `a nova senha deve ter pelo menos ${PASSWORD_MIN} caracteres`,
  })
  @MaxLength(PASSWORD_MAX)
  newPassword!: string;
}
