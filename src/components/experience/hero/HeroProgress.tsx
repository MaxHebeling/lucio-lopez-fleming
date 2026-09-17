const nn = (n: number) => String(n).padStart(2, "0");

/**
 * Indicador de progreso del recorrido (solo en el modo fijado de desktop): `01 / 07`, barra vertical fina y el nombre
 * de la escena activa. La lista de nombres es accesible (`aria-current="step"` en la activa); el contador y el nombre
 * visibles son decorativos (repiten la lista). El motor actualiza `data-active` y la barra (`--jr-progress`).
 */
export function HeroProgress({ labels }: { labels: string[] }) {
  return (
    <div className="jr-progress" data-jr-progress role="group" aria-label="Progreso del recorrido">
      <p className="jr-progress-count tabular" aria-hidden>
        <span data-jr-count>01</span> / {nn(labels.length)}
      </p>
      <span className="jr-progress-bar" aria-hidden>
        <span className="jr-progress-fill" data-jr-fill />
      </span>
      <p className="jr-progress-name" data-jr-name aria-hidden>
        {labels[0]}
      </p>
      <ol className="sr-only">
        {labels.map((label, i) => (
          <li key={label} data-jr-step={i} aria-current={i === 0 ? "step" : undefined}>
            {label}
          </li>
        ))}
      </ol>
    </div>
  );
}
