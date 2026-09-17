/** Ambientes de las fotos (AI Photo Director). Puro: se usa en servidor y navegador. */
export const ROOM_KEYS = ["fachada", "living", "cocina", "comedor", "dormitorio", "bano", "jardin", "piscina", "exterior", "plano", "otro"] as const;
export type RoomKey = (typeof ROOM_KEYS)[number];
export const ROOM_LABEL: Record<RoomKey, string> = {
  fachada: "Fachada",
  living: "Living",
  cocina: "Cocina",
  comedor: "Comedor",
  dormitorio: "Dormitorio",
  bano: "Baño",
  jardin: "Jardín",
  piscina: "Piscina",
  exterior: "Exterior",
  plano: "Plano",
  otro: "Otro",
};
