import pg from "pg";

export function e2ePool(): pg.Pool {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL para e2e");
  return new pg.Pool({ connectionString: url, max: 2 });
}

/** Borra lo que creó un envío de prueba (lead y contacto marcados con el email/teléfono único del test). */
export async function cleanupE2eContact(pool: pg.Pool, email: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const contacts = await client.query<{ contact_id: string }>("select contact_id from contact_emails where email = $1", [email]);
    const ids = contacts.rows.map((r) => r.contact_id);
    if (ids.length) {
      await client.query("delete from activities where entity_type = 'contact' and entity_id = any($1::uuid[])", [ids]);
      await client.query("delete from leads where contact_id = any($1::uuid[])", [ids]);
      await client.query("delete from contact_emails where contact_id = any($1::uuid[])", [ids]);
      await client.query("delete from contact_phones where contact_id = any($1::uuid[])", [ids]);
      await client.query("delete from contact_roles where contact_id = any($1::uuid[])", [ids]);
      await client.query("delete from contacts where id = any($1::uuid[])", [ids]);
    }
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    console.warn("[e2e] no se pudo limpiar el contacto de prueba", (e as Error).message);
  } finally {
    client.release();
  }
}
