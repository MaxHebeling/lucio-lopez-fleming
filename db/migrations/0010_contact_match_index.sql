-- 0010 — Búsqueda de duplicados por teléfono ignorando el "9" de celulares argentinos:
-- se compara el número nacional significativo (últimos 10 dígitos).
create index contact_phones_match on contact_phones (right(phone_e164, 10)) where phone_e164 is not null;
create index contacts_merged on contacts(merged_into_id) where merged_into_id is not null;
