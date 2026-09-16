/** Muestra JSON (antes/después de auditoría, payloads) con scroll propio. */
export function JsonView({ value, label }: { value: unknown; label?: string }) {
  if (value === null || value === undefined) return <p className="text-xs text-stone">{label ? `${label}: ` : ""}—</p>;
  return (
    <div className="min-w-0">
      {label ? <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone">{label}</p> : null}
      <pre className="max-h-80 overflow-auto rounded-[var(--radius-md)] bg-paper-2 p-3 text-xs leading-relaxed text-ink-2">{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}
