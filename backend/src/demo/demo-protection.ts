import { ForbiddenException } from '@nestjs/common';

export const DEMO_ACCOUNT_LOCKED_MESSAGE =
  'Esta é uma conta de demonstração: senha, e-mail, papel e ativação não podem ser alterados. Crie um usuário novo para testar essas ações.';

/**
 * Com DEMO_MODE ligado, contas demo não podem perder o acesso: se alguém
 * trocasse a senha ou o e-mail, o próximo visitante não conseguiria entrar.
 */
export function assertDemoAccountUnlocked(
  user: { isDemo: boolean },
  demoMode: boolean,
): void {
  if (demoMode && user.isDemo) {
    throw new ForbiddenException(DEMO_ACCOUNT_LOCKED_MESSAGE);
  }
}
