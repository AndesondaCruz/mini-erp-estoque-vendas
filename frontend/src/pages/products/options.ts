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
    queryFn: () =>
      api<Paginated<Category>>('/categories', {
        query: { pageSize: 100, sort: 'name' },
      }),
    select: (page) => page.data,
  });
}

export function useSupplierOptions(enabled = true) {
  return useQuery({
    queryKey: ['suppliers', 'options'],
    queryFn: () =>
      api<Paginated<Supplier>>('/suppliers', {
        query: { pageSize: 100, sort: 'name', active: true },
      }),
    select: (page) => page.data,
    enabled,
  });
}
