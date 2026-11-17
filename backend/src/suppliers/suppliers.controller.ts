import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { Paginated } from '../common/pagination/pagination.js';
import {
  CreateSupplierDto,
  ListSuppliersQueryDto,
  SupplierDto,
  UpdateSupplierDto,
} from './dto/supplier.dto.js';
import { SuppliersService } from './suppliers.service.js';

// Fornecedores: só ADMIN e GERENTE, inclusive leitura (matriz, seção 4 do plano).
@ApiTags('suppliers')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Apenas ADMIN e GERENTE' })
@Roles('ADMIN', 'GERENTE')
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  @ApiOperation({
    summary: 'Lista fornecedores com paginação, busca e filtro de status',
  })
  list(@Query() query: ListSuppliersQueryDto): Promise<Paginated<SupplierDto>> {
    return this.suppliers.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Busca um fornecedor' })
  @ApiOkResponse({ type: SupplierDto })
  @ApiNotFoundResponse()
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<SupplierDto> {
    return this.suppliers.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Cria um fornecedor' })
  @ApiCreatedResponse({ type: SupplierDto })
  @ApiConflictResponse({ description: 'CNPJ já cadastrado' })
  create(@Body() dto: CreateSupplierDto): Promise<SupplierDto> {
    return this.suppliers.create(dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Edita um fornecedor',
    description: 'null apaga um campo opcional; active: true reativa.',
  })
  @ApiOkResponse({ type: SupplierDto })
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'CNPJ já cadastrado' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSupplierDto,
  ): Promise<SupplierDto> {
    return this.suppliers.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Desativa um fornecedor (não apaga)' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  deactivate(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.suppliers.deactivate(id);
  }
}
