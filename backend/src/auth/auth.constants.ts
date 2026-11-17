export const REFRESH_COOKIE = 'refresh_token';
// O cookie só é enviado para as rotas de autenticação, não para o resto da API.
export const REFRESH_COOKIE_PATH = '/api/v1/auth';
// Janela em que reapresentar um token recém-rotacionado é tratado como corrida
// legítima (duas abas renovando ao mesmo tempo), e não como roubo.
export const REFRESH_REUSE_GRACE_MS = 10_000;
