import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { PasswordService } from '../auth/password.service.js';
import { revokeAllUserSessions } from '../auth/sessions.js';
import {
  type Paginated,
  paginated,
  toSkipTake,
} from '../common/pagination/pagination.js';
import type { Env } from '../config/env.js';
import { assertDemoAccountUnlocked } from '../demo/demo-protection.js';
import { Prisma, type Role, type User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateUserDto } from './dto/create-user.dto.js';
import type { ListUsersQueryDto } from './dto/list-users-query.dto.js';
import type { UpdateUserDto } from './dto/update-user.dto.js';

// Formato público do usuário: nunca inclui o hash da senha nem o tokenVersion.
export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    active: user.active,
  };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** E-mails são sempre gravados e buscados em minúsculas. */
  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async list(query: ListUsersQueryDto): Promise<Paginated<PublicUser>> {
    const search = query.search?.trim();
    const where: Prisma.UserWhereInput = {
      ...(query.role && { role: query.role }),
      ...(query.active !== undefined && { active: query.active }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search.toLowerCase() } },
        ],
      }),
    };

    const [total, users] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        // `sort` já foi validado contra a lista de campos permitidos.
        // O desempate por id deixa a paginação estável quando há empates.
        orderBy: [{ [query.sort]: query.order }, { id: 'asc' }],
        ...toSkipTake(query),
      }),
    ]);

    return paginated(users.map(toPublicUser), total, query);
  }

  async findOne(id: string): Promise<PublicUser> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException('Usuário não encontrado');
    return toPublicUser(user);
  }

  async create(
    actor: AuthenticatedUser,
    dto: CreateUserDto,
    ip?: string,
  ): Promise<PublicUser> {
    const passwordHash = await this.passwords.hash(dto.password);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            name: dto.name,
            email: dto.email,
            role: dto.role,
            passwordHash,
          },
        });
        await this.audit.record(
          {
            action: 'USER_CREATED',
            userId: actor.id,
            entity: 'User',
            entityId: user.id,
            after: toPublicUser(user) as unknown as Record<string, unknown>,
            ip,
          },
          tx,
        );
        return toPublicUser(user);
      });
    } catch (error) {
      throw this.mapUniqueEmail(error);
    }
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateUserDto,
    ip?: string,
  ): Promise<PublicUser> {
    const changes = Object.fromEntries(
      Object.entries(dto).filter(([, value]) => value !== undefined),
    ) as UpdateUserDto;
    if (Object.keys(changes).length === 0) {
      throw new BadRequestException('Nenhum campo para atualizar');
    }
    const touchesAccess =
      changes.role !== undefined || changes.active !== undefined;

    try {
      return await this.prisma.$transaction(async (tx) => {
        // ORDEM IMPORTA: primeiro o lock, depois a leitura.
        // Travamos as linhas dos ADMINs ativos ANTES de ler o usuário: se
        // outra transação estiver rebaixando um ADMIN agora, esperamos ela
        // terminar e só então lemos os dados já atualizados.
        const activeAdmins = touchesAccess
          ? await tx.$queryRaw<{ id: string }[]>`
              SELECT id FROM users
              WHERE role = 'ADMIN' AND active = true
              FOR UPDATE`
          : [];

        const current = await tx.user.findUnique({ where: { id } });
        if (!current) throw new NotFoundException('Usuário não encontrado');

        const losesRole =
          changes.role !== undefined && changes.role !== current.role;
        const deactivates = changes.active === false && current.active;

        if (actor.id === id && (losesRole || deactivates)) {
          throw new ForbiddenException(
            'Você não pode alterar o próprio papel nem desativar a si mesmo',
          );
        }

        const changesEmail =
          changes.email !== undefined && changes.email !== current.email;
        if (losesRole || deactivates || changesEmail) {
          assertDemoAccountUnlocked(
            current,
            this.config.get('DEMO_MODE', { infer: true }),
          );
        }

        const isActiveAdmin = current.role === 'ADMIN' && current.active;
        const stopsBeingActiveAdmin =
          isActiveAdmin &&
          ((losesRole && changes.role !== 'ADMIN') || deactivates);
        if (stopsBeingActiveAdmin) {
          const remaining = activeAdmins.filter((admin) => admin.id !== id);
          if (remaining.length === 0) {
            throw new ConflictException(
              'É preciso manter pelo menos um ADMIN ativo',
            );
          }
        }

        const updated = await tx.user.update({
          where: { id },
          data: {
            // Campo a campo, e não "...dto": só o que está listado aqui pode
            // ser gravado, mesmo que um campo extra escape da validação
            // (proteção contra mass assignment). undefined = não altera.
            name: changes.name,
            email: changes.email,
            role: changes.role,
            active: changes.active,
            // Desativar: invalida na hora os access tokens já emitidos.
            // Sem isso, reativar o usuário em menos de 15 min faria um
            // token antigo voltar a valer.
            ...(deactivates && { tokenVersion: { increment: 1 } }),
          },
        });
        if (deactivates) await revokeAllUserSessions(tx, id);

        await this.audit.record(
          {
            action: 'USER_UPDATED',
            userId: actor.id,
            entity: 'User',
            entityId: id,
            before: toPublicUser(current) as unknown as Record<string, unknown>,
            after: toPublicUser(updated) as unknown as Record<string, unknown>,
            ip,
          },
          tx,
        );
        return toPublicUser(updated);
      });
    } catch (error) {
      throw this.mapUniqueEmail(error);
    }
  }

  /** Violação do UNIQUE de e-mail (P2002) vira 409; o resto segue igual. */
  private mapUniqueEmail(error: unknown): unknown {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return new ConflictException('E-mail já cadastrado');
    }
    return error;
  }
}
