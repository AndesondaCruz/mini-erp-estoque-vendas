/** Seções cujas telas chegam nas Fases 8 e 9 (a API já existe). */
export function ComingSoonPage({ title }: { title: string }) {
  return (
    <section aria-labelledby="titulo-secao">
      <h1 id="titulo-secao" className="text-2xl font-semibold">
        {title}
      </h1>
      <p className="mt-2 text-slate-600">Tela em construção.</p>
    </section>
  );
}
