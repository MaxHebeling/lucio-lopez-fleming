import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { requireStaffPage } from "@/server/next/context";
import { can } from "@/server/auth/actor";
import { getDb } from "@/server/db";
import { AppError } from "@/server/errors";
import { getPropertyDetail, propertyFormOptions } from "@/server/properties/queries";
import { OPERATION_LABEL, STATUS_LABEL, STATUS_TRANSITIONS, type Operation, type PropertyStatus } from "@/server/properties/schema";
import { Alert, Badge, ButtonLink, Card, formatArea, formatDate, formatDateTime, formatMoney, PageHeader, Table } from "@/components/ui";
import { ActionButton } from "@/components/crm/action-button";
import { JsonView } from "@/components/crm/json-view";
import { LEAD_STATUS, PROPERTY_STATUS_TONE, SYNC_STATUS } from "@/components/crm/labels";
import { duplicateAction, markVerifiedAction } from "../actions";
import { MediaManager } from "../_components/media-manager";
import { crmImageSource } from "@/server/media/crm-preview";
import { PriceForm, PublishControls, StatusForm } from "../_components/property-actions";
import { AgentsEditor, OwnersEditor } from "../_components/people-editors";

export const metadata: Metadata = { title: "Propiedad" };

const yesNo = (v: boolean | null) => (v === null ? null : v ? "Sí" : "No");

function Dl({ items }: { items: Array<[string, ReactNode]> }) {
  const visible = items.filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (!visible.length) return <p className="text-sm text-stone">Sin datos cargados.</p>;
  return (
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
      {visible.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs font-semibold uppercase tracking-wide text-stone">{k}</dt>
          <dd className="mt-0.5 break-words text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const AUDIT_LABEL: Record<string, string> = {
  PROPERTY_CREATED: "Alta",
  PROPERTY_DUPLICATED: "Alta por duplicación",
  PROPERTY_UPDATED: "Datos editados",
  PROPERTY_PRICE_CHANGED: "Cambio de precio",
  PROPERTY_STATUS_CHANGED: "Cambio de estado",
  PROPERTY_PUBLISHED: "Publicada",
  PROPERTY_UNPUBLISHED: "Despublicada",
  PROPERTY_AGENTS_ASSIGNED: "Agentes asignados",
  PROPERTY_OWNERS_ASSIGNED: "Propietarios asignados",
  PROPERTY_MEDIA_ADDED: "Multimedia agregada",
  PROPERTY_MEDIA_REORDERED: "Multimedia reordenada",
  PROPERTY_MEDIA_COVER_SET: "Portada cambiada",
  PROPERTY_MEDIA_UPDATED: "Texto alternativo editado",
  PROPERTY_MEDIA_DELETED: "Multimedia borrada",
  PROPERTY_VERIFIED: "Verificada (migración)",
};

export default async function PropertyDetailPage({ params, searchParams }: PageProps<"/crm/propiedades/[id]">) {
  const actor = await requireStaffPage("properties.read");
  const { id } = await params;
  const sp = await searchParams;
  const db = getDb();
  const d = await getPropertyDetail(db, actor, id).catch((e) => {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  });
  const p = d.property;
  const canUpdate = can(actor, "properties.update");
  const canPrice = can(actor, "properties.change_price");
  const canStatus = can(actor, "properties.change_status");
  const canPublish = can(actor, "properties.publish");
  const canMedia = can(actor, "properties.manage_media");
  const canPrivate = can(actor, "properties.read_private");
  const staff = canUpdate ? (await propertyFormOptions(db, actor)).staff : [];
  const status = p.status as PropertyStatus;
  const transitions = STATUS_TRANSITIONS[status] ?? [];
  const leadAgent = d.agents.find((a) => a.role === "lead");

  const sections = [
    ["datos", "Datos"],
    ["precios", "Precios"],
    ["estado", "Estado"],
    ["multimedia", `Multimedia (${d.media.length})`],
    ...(canPrivate ? [["propietarios", "Propietarios"]] : []),
    ["agentes", "Agentes"],
    ["publicaciones", "Publicaciones"],
    ...(d.leads ? [["leads", "Leads"]] : []),
    ...(d.audit ? [["auditoria", "Auditoría"]] : []),
  ] as Array<[string, string]>;

  const attributeItems: Array<[string, ReactNode]> = p.field_schema.map((f) => {
    const v = p.attributes[f.key];
    const shown = v === undefined || v === null || v === "" ? null : typeof v === "boolean" ? (v ? "Sí" : "No") : f.type === "date" ? formatDate(String(v)) : `${v}${f.unit ? ` ${f.unit}` : ""}`;
    return [f.label, shown];
  });

  return (
    <>
      <nav aria-label="Migas de pan" className="mb-2 text-sm text-stone">
        <Link href="/crm/propiedades" className="underline-offset-4 hover:underline">
          Propiedades
        </Link>{" "}
        / #{p.code}
      </nav>
      <PageHeader
        title={p.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">#{p.code}</span>
            <span>{p.type_name}</span>
            <Badge tone={PROPERTY_STATUS_TONE[p.status]}>{STATUS_LABEL[status] ?? p.status}</Badge>
            {p.is_published ? <Badge tone="success">Publicada{p.published_at ? ` desde ${formatDate(p.published_at)}` : ""}</Badge> : <Badge>No publicada</Badge>}
            {p.featured ? <Badge tone="brand">Destacada</Badge> : null}
            {p.source === "adinco_import" ? <Badge tone="info">Migrada</Badge> : null}
          </span>
        }
        actions={
          <>
            <PublishControls propertyId={p.id} isPublished={p.is_published} blockers={d.blockers} canPublish={canPublish} />
            {canUpdate ? (
              <ButtonLink href={`/crm/propiedades/${p.id}/editar`} variant="secondary" size="sm">
                Editar datos
              </ButtonLink>
            ) : null}
            {can(actor, "properties.create") ? (
              <ActionButton action={duplicateAction.bind(null, p.id)} confirm="¿Duplicar esta propiedad? Se crea un borrador nuevo sin fotos ni publicaciones." pendingLabel="Duplicando…" successHref="/crm/propiedades/{id}?duplicada=1">
                Duplicar
              </ActionButton>
            ) : null}
          </>
        }
      />

      <div className="mb-4 flex flex-col gap-2">
        {sp.creada ? <Alert tone="success">Propiedad creada como borrador.</Alert> : null}
        {sp.guardada ? <Alert tone="success">Cambios guardados.</Alert> : null}
        {sp.duplicada ? <Alert tone="success">Copia creada. Revisá los datos, cargá fotos y cambiá el estado cuando esté lista.</Alert> : null}
        {!p.is_published && d.blockers.length ? (
          <Alert tone="warning">
            <span className="font-semibold">Para publicar falta:</span>
            <ul className="mt-1 list-disc pl-5">
              {d.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
      </div>

      <nav aria-label="Secciones de la ficha" className="sticky top-14 z-10 -mx-4 mb-5 overflow-x-auto border-b border-line bg-paper/95 px-4 backdrop-blur sm:mx-0 sm:px-0">
        <ul className="flex gap-1 py-2 text-sm">
          {sections.map(([anchor, label]) => (
            <li key={anchor}>
              <a href={`#${anchor}`} className="block whitespace-nowrap rounded-[var(--radius-md)] px-3 py-1.5 font-semibold text-ink-2 hover:bg-paper-2">
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex flex-col gap-5">
        <section id="datos" className="scroll-mt-28">
          <Card title="Datos">
            <div className="flex flex-col gap-5">
              <Dl
                items={[
                  ["Ubicación", d.location.length ? d.location.map((l) => l.name).join(" › ") : null],
                  ["Dirección", [p.address_street, p.address_number, p.address_floor ? `piso ${p.address_floor}` : null, p.address_unit ? `unidad ${p.address_unit}` : null].filter(Boolean).join(" ") || null],
                  ["Dirección en el sitio", p.hide_exact_address ? "Oculta (solo zona)" : "Visible"],
                  ["Sucursal", p.branch_name],
                  ["Coordenadas", p.latitude && p.longitude ? `${p.latitude}, ${p.longitude}` : null],
                  ["Sup. total", formatArea(p.total_area_m2)],
                  ["Sup. cubierta", formatArea(p.covered_area_m2)],
                  ["Sup. descubierta", formatArea(p.uncovered_area_m2)],
                  ["Terreno", formatArea(p.land_area_m2)],
                  ["Ambientes", p.rooms],
                  ["Dormitorios", p.bedrooms],
                  ["Baños", p.bathrooms],
                  ["Toilettes", p.toilets],
                  ["Cocheras", p.garages],
                  ["Antigüedad", p.age_years === null ? null : `${p.age_years} años`],
                  ["Orientación", p.orientation],
                  ["Disposición", p.disposition],
                  ["Conservación", p.condition],
                  ["Apta crédito", yesNo(p.credit_eligible)],
                  ["Apta profesional", yesNo(p.professional_use)],
                  ["Acepta mascotas", yesNo(p.allows_pets)],
                  ...attributeItems,
                ]}
              />
              {d.features.length ? (
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone">Características</h3>
                  <ul className="flex flex-wrap gap-1.5">
                    {d.features.map((f) => (
                      <li key={f.key}>
                        <Badge>{f.name}</Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone">Descripción</h3>
                {p.description ? <p className="whitespace-pre-line text-sm leading-relaxed text-ink">{p.description}</p> : <p className="text-sm text-stone">Sin descripción.</p>}
              </div>
              <Dl
                items={[
                  ["Título SEO", p.seo_title],
                  ["Descripción SEO", p.seo_description],
                  ["URL", `/propiedades/${p.slug}`],
                  ["Origen", p.source === "adinco_import" ? `Migración${p.imported_at ? ` (${formatDate(p.imported_at)})` : ""}` : "Cargada en el CRM"],
                  ["Verificada", p.manually_verified_at ? `${formatDateTime(p.manually_verified_at)}${p.verified_by_name ? ` por ${p.verified_by_name}` : ""}` : p.source === "adinco_import" ? "Pendiente" : null],
                  ["Campos protegidos", p.protected_fields.length ? p.protected_fields.join(", ") : null],
                  ["Alta", formatDateTime(p.created_at)],
                  ["Última modificación", formatDateTime(p.updated_at)],
                ]}
              />
              {p.source === "adinco_import" && can(actor, "migration.review") ? (
                <div>
                  <ActionButton action={markVerifiedAction.bind(null, p.id)} confirm="¿Confirmás que revisaste esta propiedad contra el sitio anterior?" pendingLabel="Guardando…">
                    {p.manually_verified_at ? "Volver a marcar como verificada" : "Marcar como verificada"}
                  </ActionButton>
                </div>
              ) : null}
            </div>
          </Card>
        </section>

        <section id="precios" className="scroll-mt-28">
          <Card title="Precios">
            <div className="flex flex-col gap-5">
              {d.operations.length ? (
                <Table label="Precios">
                  <thead>
                    <tr>
                      <th scope="col">Operación</th>
                      <th scope="col">Precio</th>
                      <th scope="col">Expensas</th>
                      <th scope="col">En el sitio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.operations.map((o) => (
                      <tr key={o.id}>
                        <td>{OPERATION_LABEL[o.operation as Operation] ?? o.operation}</td>
                        <td className="font-semibold">{formatMoney(o.amount, o.currency)}</td>
                        <td>{o.expenses_amount ? formatMoney(o.expenses_amount, o.expenses_currency ?? "ARS") : "—"}</td>
                        <td>{o.price_hidden ? "Consultar" : "Visible"}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : (
                <p className="text-sm text-stone">Sin operaciones cargadas.</p>
              )}
              {canPrice ? (
                <details className="rounded-[var(--radius-md)] border border-line p-3">
                  <summary className="cursor-pointer text-sm font-semibold">Cambiar precio o agregar operación</summary>
                  <div className="mt-3">
                    <PriceForm propertyId={p.id} operations={d.operations} />
                  </div>
                </details>
              ) : null}
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone">Historial de precios</h3>
                {d.priceHistory.length ? (
                  <ol className="flex flex-col divide-y divide-line text-sm">
                    {d.priceHistory.map((h) => (
                      <li key={h.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
                        <span>
                          <span className="text-stone">{OPERATION_LABEL[h.operation as Operation] ?? h.operation}: </span>
                          {h.previous_amount !== null || h.previous_currency ? <span className="text-stone line-through">{formatMoney(h.previous_amount, h.previous_currency ?? h.new_currency)}</span> : null}{" "}
                          <span className="font-semibold">{formatMoney(h.new_amount, h.new_currency)}</span>
                          {h.reason ? <span className="block text-xs text-ink-2">Motivo: {h.reason}</span> : null}
                        </span>
                        <span className="text-xs text-stone">
                          {formatDateTime(h.changed_at)} · {h.changed_by_name ?? (h.source === "import" ? "Importación" : "Sistema")}
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-sm text-stone">Sin cambios registrados.</p>
                )}
              </div>
            </div>
          </Card>
        </section>

        <section id="estado" className="scroll-mt-28">
          <Card title="Estado">
            <div className="flex flex-col gap-5">
              {canStatus ? <StatusForm propertyId={p.id} current={p.status} transitions={transitions} labels={STATUS_LABEL} isPublished={p.is_published} /> : null}
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone">Historial de estados</h3>
                <ol className="flex flex-col divide-y divide-line text-sm">
                  {d.statusHistory.map((h) => (
                    <li key={h.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
                      <span>
                        {h.from_status ? `${STATUS_LABEL[h.from_status as PropertyStatus] ?? h.from_status} → ` : ""}
                        <span className="font-semibold">{STATUS_LABEL[h.to_status as PropertyStatus] ?? h.to_status}</span>
                        {h.reason ? <span className="block text-xs text-ink-2">Motivo: {h.reason}</span> : null}
                      </span>
                      <span className="text-xs text-stone">
                        {formatDateTime(h.changed_at)} · {h.changed_by_name ?? "Sistema"}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </Card>
        </section>

        <section id="multimedia" className="scroll-mt-28">
          <Card title="Multimedia">
            <MediaManager propertyId={p.id} media={d.media.map((m) => ({ ...m, preview: crmImageSource(m) }))} canManage={canMedia} />
          </Card>
        </section>

        {canPrivate && d.owners ? (
          <section id="propietarios" className="scroll-mt-28">
            <Card title="Propietarios">
              {canUpdate ? (
                <OwnersEditor propertyId={p.id} initial={d.owners.map((o) => ({ contactId: o.contact_id, name: o.display_name, email: o.email, sharePct: o.share_pct ? String(Number(o.share_pct)) : "", isPrimary: o.is_primary }))} />
              ) : d.owners.length ? (
                <ul className="flex flex-col gap-2 text-sm">
                  {d.owners.map((o) => (
                    <li key={o.contact_id}>
                      <span className="font-semibold">{o.display_name}</span>
                      {o.is_primary ? " (principal)" : ""}
                      {o.share_pct ? ` · ${Number(o.share_pct)}%` : ""}
                      {[o.email, o.phone].filter(Boolean).length ? <span className="block text-xs text-stone">{[o.email, o.phone].filter(Boolean).join(" · ")}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-stone">Sin propietarios asignados.</p>
              )}
            </Card>
          </section>
        ) : null}

        <section id="agentes" className="scroll-mt-28">
          <Card title="Agentes">
            {canUpdate ? (
              <AgentsEditor
                propertyId={p.id}
                staff={[...staff, ...d.agents.filter((a) => !staff.some((s) => s.id === a.user_id)).map((a) => ({ id: a.user_id, full_name: `${a.full_name} (inactivo)` }))]}
                lead={leadAgent?.user_id ?? null}
                support={d.agents.filter((a) => a.role === "support").map((a) => a.user_id)}
              />
            ) : d.agents.length ? (
              <ul className="flex flex-col gap-1 text-sm">
                {d.agents.map((a) => (
                  <li key={a.user_id}>
                    {a.full_name} <span className="text-stone">· {a.role === "lead" ? "Responsable" : "Apoyo"}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-stone">Sin agentes asignados.</p>
            )}
          </Card>
        </section>

        <section id="publicaciones" className="scroll-mt-28">
          <Card title="Publicaciones por canal">
            <Table label="Publicaciones por canal">
              <thead>
                <tr>
                  <th scope="col">Canal</th>
                  <th scope="col">Deseado</th>
                  <th scope="col">Sincronización</th>
                  <th scope="col">Último intento</th>
                  <th scope="col">Detalle</th>
                </tr>
              </thead>
              <tbody>
                {d.publications.map((c) => {
                  const sync = c.sync_status ? SYNC_STATUS[c.sync_status] : null;
                  return (
                    <tr key={c.key}>
                      <td>
                        <span className="font-semibold">{c.name}</span>
                        {!c.is_enabled ? <span className="block text-xs text-stone">Canal no habilitado</span> : null}
                      </td>
                      <td>{c.desired_state === "published" ? "Publicada" : c.desired_state === "unpublished" ? "No publicada" : "—"}</td>
                      <td>{sync ? <Badge tone={sync.tone}>{sync.label}</Badge> : <span className="text-stone">Nunca se publicó</span>}</td>
                      <td className="text-xs text-stone">{formatDateTime(c.last_attempt_at ?? c.last_synced_at)}</td>
                      <td className="max-w-72 text-xs">
                        {c.last_error ? <span className="text-danger">{c.last_error}</span> : null}
                        {c.external_url ? (
                          <a href={c.external_url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
                            Ver en el portal
                          </a>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>
        </section>

        {d.leads ? (
          <section id="leads" className="scroll-mt-28">
            <Card title="Leads relacionados">
              {d.leads.length ? (
                <Table label="Leads relacionados">
                  <thead>
                    <tr>
                      <th scope="col">Contacto</th>
                      <th scope="col">Fuente</th>
                      <th scope="col">Estado</th>
                      <th scope="col">Asignado</th>
                      <th scope="col">Recibido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.leads.map((l) => (
                      <tr key={l.id}>
                        <td>
                          <Link href={`/crm/leads/${l.id}`} className="font-semibold underline-offset-4 hover:underline">
                            {l.contact_name}
                          </Link>
                        </td>
                        <td>{l.source_name}</td>
                        <td>
                          {LEAD_STATUS[l.status] ?? l.status}
                          {!l.first_response_at && ["new", "contacted", "qualified"].includes(l.status) ? <Badge tone="warning" className="ml-1">Sin responder</Badge> : null}
                        </td>
                        <td>{l.assigned_name ?? <span className="text-stone">Sin asignar</span>}</td>
                        <td className="text-xs text-stone">{formatDateTime(l.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : (
                <p className="text-sm text-stone">{can(actor, "leads.read_all") ? "Todavía no hay consultas por esta propiedad." : "No tenés consultas asignadas sobre esta propiedad."}</p>
              )}
            </Card>
          </section>
        ) : null}

        {d.audit ? (
          <section id="auditoria" className="scroll-mt-28">
            <Card
              title="Auditoría"
              actions={
                <Link href={`/crm/auditoria?entityType=property&entityId=${p.id}`} className="text-xs font-semibold underline underline-offset-4">
                  Ver todo
                </Link>
              }
            >
              <ol className="flex flex-col divide-y divide-line text-sm">
                {d.audit.map((a) => (
                  <li key={a.id} className="py-2">
                    <details>
                      <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                        <span className="font-semibold">{AUDIT_LABEL[a.action] ?? a.action}</span>
                        <span className="text-xs text-stone">
                          {formatDateTime(a.occurred_at)} · {a.actor_name ?? (a.actor_kind === "system" ? "Sistema" : a.actor_kind)}
                        </span>
                      </summary>
                      <div className="mt-2 grid gap-2 md:grid-cols-2">
                        <JsonView label="Antes" value={a.before} />
                        <JsonView label="Después" value={a.after} />
                      </div>
                    </details>
                  </li>
                ))}
              </ol>
            </Card>
          </section>
        ) : null}
      </div>
    </>
  );
}
