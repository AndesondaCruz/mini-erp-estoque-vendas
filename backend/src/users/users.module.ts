import { Module } from '@nestjs/common';
import { PasswordService } from '../auth/password.service.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

// O PasswordService é fornecido aqui (senha é dado do usuário) e exportado
// para o AuthModule, que importa este módulo. Se o UsersModule importasse o
// AuthModule, os dois dependeriam um do outro (dependência circular).
@Module({
  controllers: [UsersController],
  providers: [UsersService, PasswordService],
  exports: [UsersService, PasswordService],
})
export class UsersModule {}
