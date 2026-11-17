import { ApiProperty } from '@nestjs/swagger';
import { Role } from '../../generated/prisma/enums.js';

export class PublicUserDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ enum: Role }) role!: Role;
  @ApiProperty() active!: boolean;
}

// O refresh token NÃO aparece aqui: ele vai só no cookie httpOnly.
export class AuthResponseDto {
  @ApiProperty() accessToken!: string;
  @ApiProperty({ example: 'Bearer' }) tokenType!: 'Bearer';
  @ApiProperty({ description: 'Validade do access token, em segundos' })
  expiresIn!: number;
  @ApiProperty({ type: PublicUserDto }) user!: PublicUserDto;
}
