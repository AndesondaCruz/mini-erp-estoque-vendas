import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { Category, Paginated, Supplier } from '../../lib/types';

/**
 * Opções dos selects de categoria e fornecedor. Usa o maior pageSize da API
 * (100): para um comércio pequeno basta. Com mais itens, o caminho seria um
 * campo com busca (combobox) em vez de select.
 */
export function useCategoryOptions() {
  return useQuery({
    queryKey: ['categories', 'options'],
    queryFn: ({ signal }) =>
      api<Paginated<Category>>('/categories', {
        signal,
        query: { pageSize: 100, sort: 'name' },
      }),
    select: (page) => page.data,
  });
}

export function useSupplierOptions(enabled = true) {
  return useQuery({
    queryKey: ['suppliers', 'options'],
    queryFn: ({ signal }) =>
      api<Paginated<Supplier>>('/suppliers', {
        signal,
        query: { pageSize: 100, sort: 'name', active: true },
      }),
    select: (page) => page.data,
    enabled,
  });
}
