import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { Paginated } from '../common/pagination/pagination.js';
import {
  CreateProductDto,
  ListProductsQueryDto,
  ProductDto,
  UpdateProductDto,
} from './dto/product.dto.js';
import { ProductsService } from './products.service.js';

// Leitura: todos (VENDEDOR sem custo e só ativos). Escrita: ADMIN e GERENTE.
// Desativar: só ADMIN. Matriz na seção 4 do plano.
@ApiTags('products')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Papel sem permissão' })
@Roles('ADMIN', 'GERENTE')
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @Roles('ADMIN', 'GERENTE', 'VENDEDOR')
  @ApiOperation({
    summary: 'Lista produtos com filtros, paginação e ordenação',
    description: 'Para VENDEDOR: só produtos ativos e sem costPrice.',
  })
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListProductsQueryDto,
  ): Promise<Paginated<ProductDto>> {
    return this.products.list(actor, query);
  }

  @Get(':id')
  @Roles('ADMIN', 'GERENTE', 'VENDEDOR')
  @ApiOperation({ summary: 'Busca um produto' })
  @ApiOkResponse({ type: ProductDto })
  @ApiNotFoundResponse()
  findOne(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ProductDto> {
    return this.products.findOne(actor, id);
  }

  @Post()
  @ApiOperation({ summary: 'Cria um produto (saldo inicial 0)' })
  @ApiCreatedResponse({ type: ProductDto })
  @ApiBadRequestResponse({
    description: 'Dados inválidos, categoria inexistente ou fornecedor inativo',
  })
  @ApiConflictResponse({ description: 'SKU já cadastrado' })
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateProductDto,
    @Ip() ip: string,
  ): Promise<ProductDto> {
    return this.products.create(actor, dto, ip);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Edita um produto',
    description:
      'Mudança de preço é auditada. O saldo não é editável aqui. Só ADMIN envia active.',
  })
  @ApiOkResponse({ type: ProductDto })
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'SKU já cadastrado' })
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
    @Ip() ip: string,
  ): Promise<ProductDto> {
    return this.products.update(actor, id, dto, ip);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Desativa um produto (só ADMIN; não apaga)' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  deactivate(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
  ): Promise<void> {
    return this.products.deactivate(actor, id, ip);
  }
}
