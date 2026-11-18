export function Spinner({ label }: { label: string }) {
  return (
    <output className="flex items-center justify-center gap-3 p-8">
      <span
        aria-hidden="true"
        className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600"
      />
      <span className="text-sm text-slate-600">{label}</span>
    </output>
  );
}
