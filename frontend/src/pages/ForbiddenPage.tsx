import { Link } from 'react-router';

export function ForbiddenPage() {
  return (
    <section aria-labelledby="titulo-403" className="py-12 text-center">
      <h1 id="titulo-403" className="text-2xl font-semibold">
        Sem permissão
      </h1>
      <p className="mt-2 text-slate-600">
        Seu perfil não tem acesso a esta página.
      </p>
      <Link to="/" className="mt-4 inline-block text-indigo-700 underline">
        Voltar para o início
      </Link>
    </section>
  );
}
