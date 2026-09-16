/**
 * Mapa estático con tiles de OpenStreetMap (sin JS, sin librerías, sin iframes de terceros).
 * - `approximate`: círculo de zona (nunca un pin exacto) para propiedades con dirección oculta.
 * - exacto: pin, solo para oficinas o propiedades con dirección pública.
 * Tiles lazy; la caja tiene alto fijo (CLS 0). Atribución obligatoria de OSM incluida.
 */
const TILE = 256;
const GRID = 5;

function project(lat: number, lng: number, z: number) {
  const n = 2 ** z;
  const x = ((lng + 180) / 360) * n;
  const rad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  return { x, y };
}

export function StaticMap({
  lat,
  lng,
  approximate,
  label,
  zoom,
  className,
}: {
  lat: number;
  lng: number;
  approximate: boolean;
  label: string;
  zoom?: number;
  className?: string;
}) {
  const z = zoom ?? (approximate ? 14 : 16);
  const { x, y } = project(lat, lng, z);
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  const px = (x - tx) * TILE;
  const py = (y - ty) * TILE;
  const half = Math.floor(GRID / 2);
  const n = 2 ** z;
  const tiles: Array<{ key: string; src: string }> = [];
  for (let j = -half; j <= half; j++) {
    for (let i = -half; i <= half; i++) {
      const X = (((tx + i) % n) + n) % n;
      const Y = ty + j;
      tiles.push({ key: `${i}:${j}`, src: Y < 0 || Y >= n ? "" : `https://tile.openstreetmap.org/${z}/${X}/${Y}.png` });
    }
  }
  // metros por píxel en esta latitud → radio de ~600 m para la zona aproximada
  const mpp = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / n;
  const radius = Math.round(600 / mpp);
  const osmLink = `https://www.openstreetmap.org/?mlat=${approximate ? "" : lat}&mlon=${approximate ? "" : lng}#map=${approximate ? 15 : 17}/${lat}/${lng}`;

  return (
    <figure className={className}>
      <div className="osm-map h-72 rounded-[var(--radius-lg)] sm:h-96" role="img" aria-label={label}>
        <div className="osm-tiles" style={{ gridTemplateColumns: `repeat(${GRID}, ${TILE}px)`, marginLeft: -(half * TILE + px), marginTop: -(half * TILE + py) }} aria-hidden>
          {/* Tiles de 256 px ya optimizados por OSM: pasarlos por next/image solo duplicaría el tráfico. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {tiles.map((t) => (t.src ? <img key={t.key} src={t.src} alt="" loading="lazy" decoding="async" width={TILE} height={TILE} referrerPolicy="strict-origin-when-cross-origin" /> : <span key={t.key} className="block size-64" />))}
        </div>
        {approximate ? (
          <span
            aria-hidden
            className="absolute left-1/2 top-1/2 rounded-full border-2 border-brick bg-brick/15"
            style={{ width: radius * 2, height: radius * 2, marginLeft: -radius, marginTop: -radius }}
          />
        ) : (
          <span aria-hidden className="absolute left-1/2 top-1/2 -ml-3 -mt-6">
            <svg viewBox="0 0 24 32" className="h-8 w-6 drop-shadow">
              <path d="M12 0C5.4 0 0 5.3 0 11.9 0 20.8 12 32 12 32s12-11.2 12-20.1C24 5.3 18.6 0 12 0Z" fill="#ae2c25" />
              <circle cx="12" cy="12" r="4.5" fill="#f4f0ea" />
            </svg>
          </span>
        )}
        <span className="absolute bottom-0 right-0 bg-paper/90 px-2 py-0.5 text-[11px] text-ink-2">
          ©{" "}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="underline">
            OpenStreetMap
          </a>
        </span>
      </div>
      <figcaption className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-ink-2">
        <span>{approximate ? "Ubicación aproximada: la dirección exacta se comparte al coordinar la visita." : label}</span>
        <a href={osmLink} target="_blank" rel="noopener noreferrer" className="link-arrow text-ink">
          Abrir en OpenStreetMap
        </a>
      </figcaption>
    </figure>
  );
}
