import { SetMetadata } from '@nestjs/common';

export const STRICT_THROTTLE_KEY = 'strictThrottle';

/**
 * Aplica o limitador "strict" (STRICT_THROTTLE_LIMIT por STRICT_THROTTLE_TTL_MS)
 * além do limite global. Usado em rotas alvo de força bruta, como o login.
 */
export const StrictThrottle = () => SetMetadata(STRICT_THROTTLE_KEY, true);
