import type { Metadata } from "next";
import Link from "next/link";
import { pageMetadata } from "@/components/site/seo";
import { LegalPage } from "../legal";

export const metadata: Metadata = pageMetadata({ title: "Términos de uso", description: "Condiciones de uso del sitio de Lucio López Fleming Inmobiliaria: información de propiedades, ubicaciones, formularios y propiedad intelectual.", path: "/terminos" });

export default function TerminosPage() {
  return (
    <LegalPage title="Términos de uso" updated="septiembre de 2026">
      <section>
        <h2>1. Alcance</h2>
        <p>Estos términos regulan el uso de este sitio web, operado por Lucio López Fleming Inmobiliaria (en adelante, «la inmobiliaria»). Al navegarlo aceptás estas condiciones.</p>
      </section>
      <section>
        <h2>2. Información de las propiedades</h2>
        <p>
          Las descripciones, superficies, fotografías, precios y demás datos se publican a modo informativo y pueden modificarse sin previo aviso. Las medidas y superficies son aproximadas.
          La disponibilidad, el precio y las condiciones de cada operación deben confirmarse con la inmobiliaria. Nada de lo publicado constituye una oferta vinculante.
        </p>
      </section>
      <section>
        <h2>3. Ubicaciones</h2>
        <p>Por seguridad de los propietarios, la ubicación de muchas propiedades se muestra de forma aproximada. La dirección exacta se informa al coordinar la visita.</p>
      </section>
      <section>
        <h2>4. Formularios y contacto</h2>
        <p>
          Los datos que envíes por formularios o WhatsApp se usan para responder tu consulta, según la <Link href="/privacidad" className="underline underline-offset-4">política de privacidad</Link>. Te pedimos que
          los datos sean verdaderos y no envíes información de terceros sin su autorización.
        </p>
      </section>
      <section>
        <h2>5. Propiedad intelectual</h2>
        <p>La marca, el logo, los textos y las fotografías del sitio pertenecen a la inmobiliaria o a sus titulares y no pueden reproducirse sin autorización.</p>
      </section>
      <section>
        <h2>6. Enlaces externos</h2>
        <p>El sitio puede incluir enlaces a servicios de terceros (por ejemplo, WhatsApp, redes sociales u OpenStreetMap), que se rigen por sus propias condiciones.</p>
      </section>
      <section>
        <h2>7. Contacto</h2>
        <p>
          Por cualquier consulta sobre estos términos, escribinos desde la página de <Link href="/contacto" className="underline underline-offset-4">contacto</Link>.
        </p>
      </section>
    </LegalPage>
  );
}
