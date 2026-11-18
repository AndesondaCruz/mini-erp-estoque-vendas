import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Erro 4xx não melhora tentando de novo (permissão, validação, 404).
        retry: (failures, error) =>
          !(error instanceof ApiError && error.status < 500) && failures < 2,
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
    },
  });
}
