import { getSiteInfo } from "@/server/site/info";
import { telHref, whatsappHref } from "@/server/properties/public-helpers";
import { FloatingContact } from "@/components/experience/FloatingContact";

/** Datos reales para el contacto flotante: WhatsApp general solo si está configurado; si no, el teléfono de la casa central. */
export async function SiteFloatingContact() {
  const info = await getSiteInfo();
  const phoneHref = telHref(info.mainPhone);
  return (
    <FloatingContact
      phone={info.mainPhone && phoneHref ? { label: info.mainPhone.replace(/^\+54\s?/, ""), href: phoneHref } : null}
      whatsappHref={whatsappHref(info.whatsappE164, "Hola, les escribo desde la web de Lucio López Fleming.")}
    />
  );
}
