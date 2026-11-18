import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <main className="py-12 text-center">
      <h1 className="text-2xl font-semibold">Página não encontrada</h1>
      <p className="mt-2 text-slate-600">O endereço não existe.</p>
      <Link to="/" className="mt-4 inline-block text-indigo-700 underline">
        Voltar para o início
      </Link>
    </main>
  );
}
