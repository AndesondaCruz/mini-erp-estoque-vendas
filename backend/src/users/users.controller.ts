import {
  Body,
  Controller,
  Get,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { PublicUserDto } from '../auth/dto/auth-response.dto.js';
import type { Paginated } from '../common/pagination/pagination.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { ListUsersQueryDto } from './dto/list-users-query.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { type PublicUser, UsersService } from './users.service.js';

// Todas as rotas: só ADMIN (matriz de permissões, seção 4 do plano).
@ApiTags('users')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Apenas ADMIN' })
@Roles('ADMIN')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({
    summary: 'Lista usuários com paginação, filtros e ordenação',
  })
  list(@Query() query: ListUsersQueryDto): Promise<Paginated<PublicUser>> {
    return this.users.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Busca um usuário' })
  @ApiOkResponse({ type: PublicUserDto })
  @ApiNotFoundResponse()
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<PublicUser> {
    return this.users.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Cria um usuário' })
  @ApiCreatedResponse({ type: PublicUserDto })
  @ApiConflictResponse({ description: 'E-mail já cadastrado' })
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateUserDto,
    @Ip() ip: string,
  ): Promise<PublicUser> {
    return this.users.create(actor, dto, ip);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Edita nome, e-mail, papel ou status',
    description:
      'Desativar encerra as sessões do usuário. Não é possível alterar o próprio papel, desativar a si mesmo ou deixar o sistema sem ADMIN ativo.',
  })
  @ApiOkResponse({ type: PublicUserDto })
  @ApiConflictResponse({
    description: 'E-mail já cadastrado ou último ADMIN ativo',
  })
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @Ip() ip: string,
  ): Promise<PublicUser> {
    return this.users.update(actor, id, dto, ip);
  }
}
