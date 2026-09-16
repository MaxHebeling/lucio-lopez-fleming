import { argenpropAdapter, zonapropAdapter } from "./agreement-only";
import { mercadoLibreAdapter } from "./mercadolibre/adapter";
import type { PortalAdapter } from "./types";

const adapters = new Map<string, PortalAdapter>([
  [mercadoLibreAdapter.channelKey, mercadoLibreAdapter],
  [argenpropAdapter.channelKey, argenpropAdapter],
  [zonapropAdapter.channelKey, zonapropAdapter],
]);

export function portalAdapter(channelKey: string): PortalAdapter | undefined {
  return adapters.get(channelKey);
}

/** Solo tests: reemplaza un adaptador (HTTP mockeado a nivel adaptador). */
export function setPortalAdapterForTests(channelKey: string, adapter: PortalAdapter | undefined, original?: PortalAdapter): void {
  if (adapter) adapters.set(channelKey, adapter);
  else if (original) adapters.set(channelKey, original);
}
