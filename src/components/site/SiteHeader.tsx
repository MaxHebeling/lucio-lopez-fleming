import { getSiteInfo } from "@/server/site/info";
import { telHref, whatsappHref } from "@/server/properties/public-helpers";
import { HeaderShell } from "./HeaderShell";

export async function SiteHeader() {
  const info = await getSiteInfo();
  const phoneHref = telHref(info.mainPhone);
  return (
    <HeaderShell
      phone={info.mainPhone && phoneHref ? { label: info.mainPhone.replace(/^\+54\s?/, ""), href: phoneHref } : null}
      whatsappHref={whatsappHref(info.whatsappE164, "Hola, les escribo desde la web de Lucio López Fleming.")}
    />
  );
}
