/** Estado que devuelven las Server Actions de alquileres a los formularios (serializable). */
export type FormState = {
  ok?: boolean;
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string[]>;
  /** Cambia en cada respuesta exitosa: permite regenerar claves de idempotencia y limpiar formularios. */
  nonce?: string;
  data?: Record<string, unknown>;
};
export const initialFormState: FormState = {};
