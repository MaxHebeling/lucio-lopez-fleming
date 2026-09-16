"use client";

/**
 * Buscador con lista de sugerencias (patrón combobox ARIA) que guarda el id elegido en un input oculto.
 * La búsqueda corre en el servidor (acción con permisos); acá solo se muestran resultados.
 */
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { cx } from "@/components/ui";
import { useFormCtx, type ClientActionResult } from "./action-form";

export type SearchOption = { id: string; label: string; sublabel?: string | null };

export function EntitySearch({
  name,
  label,
  search,
  initial,
  placeholder,
  hint,
  onSelect,
}: {
  name: string;
  label: string;
  search: (q: string) => Promise<ClientActionResult<SearchOption[]>>;
  initial?: SearchOption | null;
  placeholder?: string;
  hint?: string;
  onSelect?: (o: SearchOption | null) => void;
}) {
  const { errors, formId } = useFormCtx();
  const baseId = `${formId}-${name}`;
  const listId = useId();
  const [selected, setSelected] = useState<SearchOption | null>(initial ?? null);
  const [query, setQuery] = useState(initial?.label ?? "");
  const [options, setOptions] = useState<SearchOption[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errs = errors[name] ?? [];

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function runSearch(q: string) {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 1) {
      setOptions([]);
      setOpen(false);
      return;
    }
    timer.current = setTimeout(() => {
      start(async () => {
        const r = await search(q);
        if (r.ok) {
          setOptions(r.data);
          setError(null);
          setOpen(true);
          setActive(r.data.length ? 0 : -1);
        } else setError(r.error);
      });
    }, 250);
  }

  function choose(o: SearchOption | null) {
    setSelected(o);
    setQuery(o?.label ?? "");
    setOpen(false);
    onSelect?.(o);
  }

  return (
    <div className="relative flex flex-col gap-1.5">
      <label htmlFor={baseId} className="text-xs font-semibold uppercase tracking-wide text-ink-2">
        {label}
      </label>
      <input type="hidden" name={name} value={selected?.id ?? ""} />
      <div className="flex gap-2">
        <input
          id={baseId}
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
          aria-invalid={errs.length ? true : undefined}
          aria-describedby={errs.length ? `${baseId}-error` : undefined}
          autoComplete="off"
          placeholder={placeholder}
          value={query}
          className="h-10 w-full rounded-[var(--radius-md)] border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-stone focus:border-ink focus:outline-none aria-[invalid=true]:border-danger"
          onChange={(e) => {
            setQuery(e.target.value);
            if (selected) {
              setSelected(null);
              onSelect?.(null);
            }
            runSearch(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && options.length) {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(options.length - 1, a + 1));
            } else if (e.key === "ArrowUp" && options.length) {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter" && open && active >= 0 && options[active]) {
              e.preventDefault();
              choose(options[active]!);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
        {selected ? (
          <button type="button" className="rounded-[var(--radius-md)] px-3 text-sm font-semibold text-ink-2 hover:bg-paper-2" onClick={() => choose(null)}>
            Quitar
          </button>
        ) : null}
      </div>
      <p className="text-xs text-stone" aria-live="polite">
        {pending ? "Buscando…" : selected ? `Elegido: ${selected.label}` : (hint ?? "")}
      </p>
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
      {errs.map((e) => (
        <p key={e} id={`${baseId}-error`} role="alert" className="text-xs text-danger">
          {e}
        </p>
      ))}
      {open ? (
        <ul id={listId} role="listbox" className="absolute top-[4.5rem] z-10 max-h-72 w-full overflow-y-auto rounded-[var(--radius-md)] border border-line bg-white shadow-[var(--shadow-soft)]">
          {options.length === 0 ? (
            <li className="px-3 py-2 text-sm text-stone">Sin resultados</li>
          ) : (
            options.map((o, i) => (
              <li
                key={o.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={cx("cursor-pointer px-3 py-2 text-sm", i === active ? "bg-paper-2" : "")}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(o);
                }}
              >
                <span className="block font-semibold text-ink">{o.label}</span>
                {o.sublabel ? <span className="block text-xs text-stone">{o.sublabel}</span> : null}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
