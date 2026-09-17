/**
 * Fuente de miniaturas del CRM. Pasa por el optimizador de Next (`next/image` sin `unoptimized`) siempre que el
 * optimizador pueda leer el original: hosts de `images.remotePatterns` (fotos migradas, storage público) y archivos
 * públicos del driver local (/api/files/:id responde los bytes). Los privados y los redirigidos (s3 sin URL pública)
 * se muestran tal cual: el optimizador no manda la sesión ni sigue redirecciones.
 */
export type CrmMediaRef = {
  file_id: string | null;
  source_url: string | null;
  file_storage_driver?: string | null;
  file_storage_key?: string | null;
  file_visibility?: string | null;
};

export type CrmImageSource = { src: string; optimize: boolean };

const MIGRATED_HOSTS = new Set(["static1.adinco.net"]);

export function crmImageSource(m: CrmMediaRef): CrmImageSource | null {
  const publicBase = process.env.STORAGE_PUBLIC_BASE_URL?.replace(/\/$/, "");
  if (m.file_id) {
    const isPublic = m.file_visibility === "public";
    if (isPublic && m.file_storage_driver === "s3" && m.file_storage_key && publicBase) return { src: `${publicBase}/${m.file_storage_key}`, optimize: true };
    return { src: `/api/files/${m.file_id}`, optimize: isPublic && m.file_storage_driver !== "s3" };
  }
  if (m.source_url && /^https:\/\//.test(m.source_url)) {
    let host = "";
    try {
      host = new URL(m.source_url).hostname;
    } catch {
      return null;
    }
    const storageHost = publicBase ? new URL(publicBase).hostname : null;
    return { src: m.source_url, optimize: MIGRATED_HOSTS.has(host) || host === storageHost };
  }
  return null;
}
