import Image, { type StaticImageData } from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Reveal } from "./Reveal";

export type StoryStep = { title: string; body: string; cta: { href: string; label: string }; photo: StaticImageData; alt: string };

/**
 * Nivel 2 · Sticky story. En desktop la foto queda fija mientras los pasos avanzan; el paso activo (IntersectionObserver
 * en motion/story.ts) cruza la foto y mueve el indicador. En mobile es una lista normal con su foto por paso.
 * Sin JS: primer paso con su foto y todos los textos legibles.
 */
export function StickyStory({ id, eyebrow, title, steps }: { id: string; eyebrow: string; title: string; steps: StoryStep[] }) {
  return (
    <section className="py-[var(--section-y)]" aria-labelledby={`${id}-title`} data-story>
      <div className="container-site">
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-12">
          <div className="lg:col-span-5">
            <div className="lg:sticky lg:top-[calc(var(--header-h)+2.5rem)]">
              <p className="eyebrow text-brick">{eyebrow}</p>
              <h2 id={`${id}-title`} className="display h2 mt-5">
                {title}
              </h2>
              <div className="story-media mt-10 hidden aspect-[4/5] overflow-hidden rounded-[var(--radius-lg)] bg-paper-2 lg:block">
                {steps.map((s, i) => (
                  <div key={s.title} className="story-photo" data-idx={i}>
                    <Image src={s.photo} alt={s.alt} fill sizes="(min-width: 1024px) 38vw, 1px" className="object-cover" placeholder="blur" />
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="relative lg:col-span-6 lg:col-start-7">
            <span aria-hidden className="absolute left-0 top-0 hidden h-full w-px bg-line lg:block">
              <span className="story-progress block h-full w-px bg-brick" />
            </span>
            <ol className="grid gap-16 lg:gap-0">
              {steps.map((s, i) => (
                <li key={s.title} className="story-step lg:flex lg:min-h-[78svh] lg:items-center lg:pl-14" data-story-step={i}>
                  <Reveal>
                    <div className="media-frame mb-6 aspect-[16/10] rounded-[var(--radius-lg)] lg:hidden">
                      <Image src={s.photo} alt={s.alt} fill sizes="92vw" className="reveal-img object-cover" placeholder="blur" />
                    </div>
                    <p className="story-num tabular text-sm font-semibold text-brick">0{i + 1}</p>
                    <h3 className="display h3 mt-3">{s.title}</h3>
                    <p className="mt-5 max-w-lg text-lg leading-relaxed text-ink-2">{s.body}</p>
                    <Link href={s.cta.href} className="btn btn-outline btn-arrow mt-8">
                      {s.cta.label} <ArrowRight aria-hidden className="btn-icon size-4" />
                    </Link>
                  </Reveal>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}
