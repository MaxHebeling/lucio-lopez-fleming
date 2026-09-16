import type { Metadata } from "next";
import Link from "next/link";
import { pageMetadata } from "@/components/site/seo";
import { LegalPage } from "../legal";

export const metadata: Metadata = pageMetadata({ title: "Política de privacidad", description: "Cómo trata Lucio López Fleming Inmobiliaria los datos personales enviados desde este sitio.", path: "/privacidad" });

export default function PrivacidadPage() {
  return (
    <LegalPage title="Política de privacidad" updated="septiembre de 2026">
      <section>
        <h2>1. Qué datos recopilamos</h2>
        <p>Cuando completás un formulario (consulta por una propiedad, pedido de visita, tasación o contacto) recibimos los datos que nos das:</p>
        <ul>
          <li>nombre, teléfono y/o email;</li>
          <li>el mensaje y, si corresponde, la propiedad consultada o los datos de la propiedad a tasar;</li>
          <li>datos técnicos mínimos para prevenir abusos (dirección IP de la conexión) y, si llegaste desde una campaña, los parámetros de origen de la visita.</li>
        </ul>
      </section>
      <section>
        <h2>2. Para qué los usamos</h2>
        <p>Para responder tu consulta, coordinar visitas o tasaciones y hacer el seguimiento comercial de tu pedido. No vendemos ni cedemos tus datos a terceros con fines publicitarios.</p>
      </section>
      <section>
        <h2>3. Dónde se guardan y por cuánto tiempo</h2>
        <p>Se registran en el sistema de gestión de la inmobiliaria, con acceso restringido al equipo, y se conservan mientras sean necesarios para la finalidad indicada o por las obligaciones legales aplicables.</p>
      </section>
      <section>
        <h2>4. Tus derechos</h2>
        <p>
          Podés pedir acceso, rectificación, actualización o supresión de tus datos, conforme a la Ley 25.326 de Protección de los Datos Personales. Escribinos desde la página de{" "}
          <Link href="/contacto" className="underline underline-offset-4">
            contacto
          </Link>
          . La Agencia de Acceso a la Información Pública, órgano de control de la Ley 25.326, atiende las denuncias y reclamos relacionados con el incumplimiento de las normas de protección de datos personales.
        </p>
      </section>
      <section>
        <h2>5. Cookies</h2>
        <p>Este sitio no usa cookies de publicidad ni de seguimiento de terceros. Puede usar almacenamiento técnico necesario para su funcionamiento.</p>
      </section>
      <section>
        <h2>6. Cambios</h2>
        <p>Podemos actualizar esta política. La versión vigente es la publicada en esta página.</p>
      </section>
    </LegalPage>
  );
}
