import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { CategoriesService } from './categories.service.js';

// Teste unitário: o service roda de verdade, mas o banco é falso. Cada método
// do "prisma" é um vi.fn() que o teste controla (o que devolve ou que erro
// lança) e inspeciona depois (com quais argumentos foi chamado).

const prismaError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('erro simulado', {
    code,
    clientVersion: 'test',
  });

function setup() {
  const prisma = {
    category: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
  const service = new CategoriesService(prisma as unknown as PrismaService);
  return { service, prisma };
}

describe('CategoriesService', () => {
  describe('remove', () => {
    it('categoria com produtos (P2003): 409', async () => {
      // Arrange: o banco recusa o DELETE por causa da chave estrangeira.
      const { service, prisma } = setup();
      prisma.category.delete.mockRejectedValue(prismaError('P2003'));

      // Act + Assert: o service traduz o erro do Prisma para HTTP 409.
      await expect(service.remove('c1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('categoria inexistente (P2025): 404', async () => {
      const { service, prisma } = setup();
      prisma.category.delete.mockRejectedValue(prismaError('P2025'));

      await expect(service.remove('c1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('categoria sem produtos: apaga pelo id', async () => {
      const { service, prisma } = setup();
      prisma.category.delete.mockResolvedValue({ id: 'c1', name: 'Bebidas' });

      await service.remove('c1');

      // Assert sobre a CHAMADA: garante que apaga exatamente aquele id, e não,
      // por exemplo, com um where vazio.
      expect(prisma.category.delete).toHaveBeenCalledWith({
        where: { id: 'c1' },
      });
    });
  });

  describe('create', () => {
    it('nome repetido (P2002): 409 com mensagem clara', async () => {
      const { service, prisma } = setup();
      prisma.category.create.mockRejectedValue(prismaError('P2002'));

      // Conferir só o tipo deixaria passar uma mensagem trocada, como
      // "CNPJ já cadastrado" copiada de outro service. A mensagem é o que o
      // usuário lê na tela.
      await expect(service.create({ name: 'Bebidas' })).rejects.toThrow(
        new ConflictException('Já existe uma categoria com esse nome'),
      );
    });
  });

  it('erro desconhecido passa adiante sem ser mascarado', async () => {
    // Por que importa: se uma queda de conexão virasse 409 ou 404, o cliente
    // receberia uma mensagem falsa ("já existe", "não encontrado") e o erro
    // real sumiria. Passando adiante, o filtro global responde 500 e grava
    // a causa no log com o requestId, que é onde alguém vai investigar.
    const { service, prisma } = setup();
    const unexpected = new Error('conexão perdida');
    prisma.category.update.mockRejectedValue(unexpected);

    // toBe compara a identidade: é o MESMO objeto de erro, não uma cópia.
    await expect(service.update('c1', { name: 'X' })).rejects.toBe(unexpected);
  });
});
