import type { z } from "zod";

/** Entrada de servicio: acepta tanto datos crudos (tests, jobs) como ya validados por la Server Action. */
export type SchemaIn<S extends z.ZodType> = z.input<S> | z.output<S>;
