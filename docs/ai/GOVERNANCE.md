# Gobernanza de la IA

**Principio**: la empresa la dirigen personas. La IA asiste, organiza, explica, detecta, recomienda, resume y prepara.
No ejecuta operaciones sensibles. Cada regla de este documento está implementada en código y tiene test.

| Regla | Dónde vive | Test |
| --- | --- | --- |
| No alucinar | `ai/guards.ts`, `copilot/service.ts` | `ai-copilot.test.ts` › grounding, `ai-core.test.ts` › guardas |
| RBAC antes de IA | `core/registry.ts`, `core/context.ts`, `knowledge/retrieval.ts` | › RBAC y aislamiento |
| Sin herramientas `execute` | `core/registry.ts` (`PHASE_ALLOWED_CAPABILITIES`) | › registro de herramientas |
| Human in the loop | capabilities `suggest`/`draft` solo devuelven propuestas | › registro de herramientas |
| Salidas estructuradas con zod | `core/provider.ts` (`extract`), `prompts/*` | › salidas inválidas |
| Prompt injection | `core/governance.ts` (`untrustedData`), prompts | › prompt injection |
| PII mínima | `core/governance.ts` (`redactForModel`), `core/memory.ts` | › gobernanza: PII |
| Auditabilidad sin prompts | `core/usage.ts` → `ai_interactions` | › registro sin prompt |
| Degradación honesta | `copilot/notices.ts`, `copilot/service.ts` | › sin clave, fallas del proveedor |

## 1. No alucinar

- **Anclaje por turno**: el modo Asistente solo recibe fragmentos de la guía recuperados en ese turno y debe citar sus
  ids (`F1…`); un id inexistente descarta la respuesta. El modo Analista solo tiene los resultados de herramientas `read`
  de ese turno.
- **Guardas en código** (`findViolations`): toda cifra con moneda, superficie, porcentaje, código de propiedad, URL,
  email, teléfono o **ruta del CRM** (`/crm/...`) que el modelo escriba tiene que existir en la evidencia del turno
  (texto de la guía o campos estructurados de las herramientas). El texto libre de las herramientas (descripciones,
  mensajes) **no** cuenta como evidencia: un precio escrito (o inyectado) en una descripción no habilita a afirmarlo.
- **Violación → respuesta descartada**: se muestra la guía o los datos directos, con aviso, y queda registrado
  (`fallback_reason = guard_blocked`, `guard_violations` solo con el tipo, nunca el valor).
- **Hechos vs. interpretación**: en el Analista los HECHOS que ve el usuario se renderizan desde los resultados de las
  herramientas (con su origen y alcance), no desde el texto del modelo; la interpretación va aparte y rotulada
  «Interpretación de la IA (no son datos)».
- **Sin evidencia, se dice**: sin fragmentos relevantes no se llama al modelo («No encontré nada en la guía…»).

## 2. RBAC antes de IA

1. `runAction` resuelve el actor autenticado; el servicio exige `staff` + `ai.copilot` + flag `ai_copilot`.
2. **Antes de armar contexto**: el contexto de pantalla se deriva de la ruta y se re-valida con los mismos loaders y
   alcance que las páginas (`loadLead`, `loadOpportunity`, `loadAppointment`, `loadContact`, `properties.read`) **más**
   la organización. Si no se puede ver, se ignora sin revelar si existe (`entityIgnored`).
3. **Retrieval filtrado**: cada sección de la guía declara permisos (alcanza con uno); la consulta SQL filtra por los
   permisos del actor y la organización.
4. **Herramientas**: cada una declara `permissions` y `capability`. Al modelo solo se le ofrecen las que el actor puede
   usar; si pide otra (o inventa una), `ToolRegistry.invoke` vuelve a verificar herramienta registrada, capability
   permitida en el modo, permiso y entrada zod, y **no ejecuta** (queda en `tool_calls` con el código de rechazo).
5. **Alcance y multi-tenant**: las herramientas aplican el alcance propio/equipo del CRM (`crm/access.ts`) y filtran por
   `organization_id` (en tareas y citas, por la organización del usuario responsable/autor).
6. El modelo nunca decide permisos: el prompt le pide no afirmar qué permisos tiene el usuario.

## 3. Capabilities y human in the loop

| Capability | Qué puede hacer | Fase 1 |
| --- | --- | --- |
| `read` | consultar datos con el alcance del actor | todas las herramientas actuales |
| `suggest` | proponer (p. ej. próxima acción, match) — no persiste | permitida, sin herramientas todavía |
| `draft` | preparar un borrador (mensaje, publicación) que una persona confirma | permitida, sin herramientas todavía |
| `execute` | cambiar datos o enviar algo | **prohibida**: `ToolRegistry.register` lanza `AIGovernanceError` |

Habilitar `execute` en una fase futura exige: cambiar `PHASE_ALLOWED_CAPABILITIES`, confirmación humana explícita en la
UI (la herramienta devuelve una propuesta; la ejecuta un servicio normal con `requirePermission` + auditoría +
evento), tests de IDOR/permiso y actualizar este documento.

## 4. Salidas estructuradas

- `extract`: tool-use **forzado** (`tool_choice` a una herramienta) + validación zod. Inválida o ausente →
  `AIOutputError` (error controlado, `fallback_reason = invalid_output`), nunca se usa el valor.
- Analista: `output_config.format` (JSON Schema derivado del mismo zod con `responseJsonSchema`) + `JSON.parse` + zod.
- Todo lo que toque lógica de negocio pasa por zod (entradas de herramientas incluidas).

## 5. Prompt injection

- Descripciones, mensajes de clientes, documentos, contenido externo, títulos y el propio contexto de pantalla viajan
  dentro de `<datos_no_confiables origen="…">`. El contenido no puede cerrar ni abrir el delimitador
  (`[delimitador removido]`).
- Los prompts (versionados) declaran que todo lo etiquetado y la pregunta son DATOS, no instrucciones.
- Defensa en profundidad: aunque el modelo "obedezca", no hay herramientas de escritura que ofrecerle, las que pida no
  se ejecutan y las cifras inyectadas no pasan las guardas. Test con una descripción maliciosa real.

## 6. Datos personales (PII)

- `redactForModel` (reutiliza el redactor del logger) enmascara emails, teléfonos, DNI/CUIT/CUIL, CBU y coordenadas en
  la pregunta, en los resultados de herramientas y en el texto a resumir. Los importes no se tocan.
- Las herramientas devuelven lo mínimo: nombre del contacto (lo ve el usuario), nunca teléfonos, emails, documentos,
  direcciones exactas, coordenadas ni propietarios. El contexto de pantalla manda etiquetas mínimas («Lead», «Ficha de
  contacto»).
- Sesión: la pregunta se guarda minimizada; retención `ai.copilot.session_retention_days` (30) con purga diaria. El
  feedback sobrevive a la purga sin el mensaje. Los comentarios de feedback también se minimizan.

## 7. Auditabilidad

Cada pedido (con o sin modelo) deja una fila en `ai_interactions`: acción (`purpose`/`feature`), usuario, organización,
proveedor, modelo, tarea, `prompt_id@version`, herramientas (nombre, ok, código, ms — **sin parámetros ni
resultados**), resultado (`status`, `fallback_reason`), error saneado (sin emails/números), latencia, tokens, costo
estimado, retrieval (cantidad/falla), request id y timestamp. **No** se guardan prompts, fragmentos ni respuestas en esa
tabla. La respuesta mostrada vive solo en la sesión (`ai_messages`, retención acotada). Eventos `ai.*` con metadatos.

## 8. Costos y límites

- Presupuesto diario compartido (`ai.daily_budget_usd`, hora de Salta): agotado → no se llama al modelo.
- Límite por usuario (`ai.copilot.requests_per_hour`, 60): superado → mensaje claro, registrado, el resto del CRM sigue.
- Timeout por intento 20 s, 2 intentos solo ante errores reintentables, presupuesto del turno 45 s, circuit breaker
  persistido de la integración `anthropic`.
- Ruteo por tarea solo a modelos con precio conocido.

## 9. Qué NO hace la IA en la Fase 1

No envía mensajes, no cambia estados, no asigna, no agenda, no publica, no borra, no ve auditoría ni usuarios, no lee
documentos privados y no reacciona a eventos.
