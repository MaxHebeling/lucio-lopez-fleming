import type { CSSProperties, ElementType, ReactNode } from "react";

/**
 * Marca un bloque para revelarse al entrar en pantalla (nivel 3). No oculta nada en el HTML: el cliente decide
 * (components/experience/motion/reveal.ts). Server component: 0 JS propio.
 */
export function Reveal({
  as: Tag = "div",
  kind = "up",
  delay,
  className,
  children,
  group,
  ...rest
}: {
  as?: ElementType;
  kind?: "up" | "fade" | "scale" | "line";
  delay?: number;
  className?: string;
  children?: ReactNode;
  group?: number;
} & Record<string, unknown>) {
  const style = delay ? ({ "--reveal-delay": `${delay}ms` } as CSSProperties) : undefined;
  return (
    <Tag data-reveal={kind} data-reveal-group={group} className={className} style={style} {...rest}>
      {children}
    </Tag>
  );
}

/** Titular revelado por líneas (máscara + translate). Cada línea es un string; para lectores es un solo texto. */
export function TextReveal({ as: Tag = "h2", lines, className, delay, id }: { as?: ElementType; lines: ReactNode[]; className?: string; delay?: number; id?: string }) {
  return (
    <Tag id={id} data-reveal="line" className={className} style={delay ? ({ "--reveal-delay": `${delay}ms` } as CSSProperties) : undefined}>
      {lines.map((line, i) => (
        <span key={i} className="line-mask">
          <span className="line-inner" style={{ "--l": i } as CSSProperties}>
            {line}
            {i < lines.length - 1 ? " " : null}
          </span>
        </span>
      ))}
    </Tag>
  );
}

/** Línea fina que se traza al revelarse (motivo de agrimensura). Decorativa. */
export function SurveyLine({ className, delay }: { className?: string; delay?: number }) {
  return <span aria-hidden data-reveal="line" className={`survey-line ${className ?? ""}`} style={delay ? ({ "--reveal-delay": `${delay}ms` } as CSSProperties) : undefined} />;
}
