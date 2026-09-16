import { describe, expect, it } from "vitest";
import { manualLeadSchema, firstContactSchema } from "@/server/leads/service";
import { createTaskSchema, taskActionSchema } from "@/server/tasks/service";
import { closeSchema, createOpportunitySchema, moveStageSchema, updateOpportunitySchema } from "@/server/opportunities/service";
import { appointmentActionSchema, createAppointmentSchema, rescheduleSchema } from "@/server/agenda/service";
import { createContactSchema } from "@/server/contacts/crud";

const id = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

// Las Server Actions validan con el schema y el servicio vuelve a validar la salida: debe ser estable.
describe("schemas del CRM: validar dos veces da lo mismo", () => {
  it.each([
    ["manualLead", manualLeadSchema, { name: "Ana", phone: "3875123456", email: "", message: "", sourceKey: "phone", idempotencyKey: "12345678" }],
    ["firstContact", firstContactSchema, { leadId: id, channel: "call", note: "" }],
    ["createTask", createTaskSchema, { title: "Llamar", dueAt: "", description: "", idempotencyKey: "12345678" }],
    ["taskAction", taskActionSchema, { taskId: id, reason: "" }],
    ["createOpportunity", createOpportunitySchema, { contactId: id, title: "", budgetMin: "100.000", budgetMax: "", requirements: { text: "", zones: "", bedroomsMin: null } }],
    ["moveStage", moveStageSchema, { opportunityId: id, stageId: id, note: "", lostReason: "" }],
    ["close", closeSchema, { opportunityId: id, valueAmount: "", note: "" }],
    ["updateOpportunity", updateOpportunitySchema, { opportunityId: id, expectedCloseDate: "", budgetMin: "" }],
    ["createAppointment", createAppointmentSchema, { kind: "call", startsAt: "2026-09-20T10:00", durationMinutes: "30", title: "", location: "", notes: "", idempotencyKey: "12345678" }],
    ["appointmentAction", appointmentActionSchema, { appointmentId: id, result: "", reason: "" }],
    ["reschedule", rescheduleSchema, { appointmentId: id, startsAt: "2026-09-20T10:00", durationMinutes: "45", reason: "" }],
    ["createContact", createContactSchema, { firstName: "Ana", lastName: "", companyName: "", documentNumber: "", emails: [{ email: "a@b.com", label: "" }] }],
  ] as const)("%s", (_name, schema, input) => {
    const once = (schema as { parse: (v: unknown) => unknown }).parse(input);
    expect((schema as { parse: (v: unknown) => unknown }).parse(once)).toEqual(once);
  });
});
