-- 0300 — WhatsApp Business (Cloud API oficial de Meta) + asistente de IA.
-- Estados reales de envío (incluido "sin credenciales"), idempotencia de respuestas (humanas y del bot),
-- trazabilidad de estados de Meta y métricas de IA por turno (tokens, costo, herramientas, guardas).

-- ───────────── Mensajes: estados de envío y claves de idempotencia ─────────────
alter table conversation_messages drop constraint conversation_messages_status_check;
alter table conversation_messages add constraint conversation_messages_status_check
  check (status in ('received', 'queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'awaiting_credentials'));

alter table conversation_messages
  add column kind text not null default 'text'
    check (kind in ('text', 'template', 'image', 'audio', 'video', 'document', 'sticker', 'location', 'contacts',
                    'interactive', 'button', 'reaction', 'unsupported')),
  -- Respuesta del bot a un mensaje entrante concreto: una sola por mensaje (índice único abajo)
  add column reply_to_message_id uuid references conversation_messages(id) on delete set null,
  -- Doble click / reintento del formulario de respuesta humana
  add column idempotency_key text,
  add column attempts integer not null default 0 check (attempts >= 0),
  add column error_code text,
  add column status_updated_at timestamptz,
  add column sent_at timestamptz,
  add column delivered_at timestamptz,
  add column read_at timestamptz,
  add column failed_at timestamptz;

create unique index conversation_messages_idempotency on conversation_messages(idempotency_key)
  where idempotency_key is not null;
create unique index conversation_messages_one_bot_reply on conversation_messages(reply_to_message_id)
  where reply_to_message_id is not null and sender_kind = 'bot';
-- Los webhooks de estado solo traen el wamid: búsqueda por id externo sin conocer la conversación
create index conversation_messages_wamid on conversation_messages(external_message_id)
  where external_message_id is not null;
create index conversation_messages_outbound_pending on conversation_messages(status, created_at)
  where direction = 'outbound' and status in ('queued', 'sending', 'awaiting_credentials');

-- ───────────── Conversaciones: bandeja ─────────────
alter table conversations
  add column last_outbound_at timestamptz,
  add column closed_at timestamptz,
  -- Fallas consecutivas de la IA (se reinicia con una respuesta válida); al repetir se deriva a humano
  add column ai_failures integer not null default 0 check (ai_failures >= 0);

create index conversations_inbox on conversations(mode, last_message_at desc nulls last);
create index conversations_contact on conversations(contact_id);

-- ───────────── Interacciones con IA: detalle por turno ─────────────
alter table ai_interactions
  add column message_id uuid references conversation_messages(id) on delete set null,
  add column cache_read_input_tokens integer,
  add column cache_creation_input_tokens integer,
  add column rounds smallint,
  add column stop_reason text,
  add column handoff_reason text,
  add column guard_violations jsonb not null default '[]'::jsonb;

create index ai_interactions_conversation on ai_interactions(conversation_id, created_at desc);

-- Días durante los que un lead abierto de WhatsApp se reutiliza en lugar de crear otro.
insert into settings(key, value) values ('whatsapp.lead_reuse_days', '30')
on conflict (key) do nothing;
