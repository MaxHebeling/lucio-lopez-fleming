import Link from "next/link";
import { Monogram } from "@/components/experience/Monogram";

/** Logo horizontal: monograma LLF (ladrillo) + wordmark tipográfico + bajada «Buenos negocios». */
export function Logo({ className, onDark = false, onClick }: { className?: string; onDark?: boolean; onClick?: () => void }) {
  return (
    <Link href="/" onClick={onClick} className={`inline-flex items-center gap-3 ${className ?? ""}`} aria-label="Lucio López Fleming Inmobiliaria, inicio">
      <Monogram className={`logo-mono h-9 w-auto shrink-0 lg:h-10 ${onDark ? "text-paper" : "text-brick"}`} />
      <span className="flex flex-col whitespace-nowrap leading-none">
        <span className="text-[0.98rem] font-bold sm:text-[1.02rem] tracking-[-0.01em] lg:text-[1.12rem]">Lucio López Fleming</span>
        <span className={`logo-tag mt-1 text-[0.56rem] font-bold uppercase tracking-[0.26em] ${onDark ? "text-paper/80" : "text-brick"}`}>Buenos negocios</span>
      </span>
    </Link>
  );
}
