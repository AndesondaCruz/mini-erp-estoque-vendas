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
import { CategoriesService } from './categories.service.js';
import {
  CategoryDto,
  CreateCategoryDto,
  ListCategoriesQueryDto,
  UpdateCategoryDto,
} from './dto/category.dto.js';

// Leitura: todos os papéis. Escrita: ADMIN e GERENTE (matriz, seção 4 do plano).
@ApiTags('categories')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Papel sem permissão' })
@Roles('ADMIN', 'GERENTE')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @Roles('ADMIN', 'GERENTE', 'VENDEDOR')
  @ApiOperation({ summary: 'Lista categorias com paginação e busca por nome' })
  list(
    @Query() query: ListCategoriesQueryDto,
  ): Promise<Paginated<CategoryDto>> {
    return this.categories.list(query);
  }

  @Post()
  @ApiOperation({ summary: 'Cria uma categoria' })
  @ApiCreatedResponse({ type: CategoryDto })
  @ApiConflictResponse({ description: 'Nome já cadastrado' })
  create(@Body() dto: CreateCategoryDto): Promise<CategoryDto> {
    return this.categories.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Renomeia uma categoria' })
  @ApiOkResponse({ type: CategoryDto })
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'Nome já cadastrado' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ): Promise<CategoryDto> {
    return this.categories.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Exclui uma categoria sem produtos' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'Categoria com produtos vinculados' })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.categories.remove(id);
  }
}
