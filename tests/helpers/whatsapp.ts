import { computeSignature } from "../../src/server/integrations/whatsapp/signature";

export const TEST_APP_SECRET = "test-app-secret-no-real";
export const TEST_PHONE_NUMBER_ID = "100000000000001";

let seq = 0;

export function inboundTextPayload(opts: { waId: string; text: string; name?: string; wamid?: string; timestamp?: number; type?: string; extra?: Record<string, unknown> }) {
  const wamid = opts.wamid ?? `wamid.TEST${Date.now()}${++seq}`;
  const type = opts.type ?? "text";
  return {
    wamid,
    body: {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA_ID",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { display_phone_number: "5493870000000", phone_number_id: TEST_PHONE_NUMBER_ID },
                contacts: [{ profile: { name: opts.name ?? "Cliente Prueba" }, wa_id: opts.waId }],
                messages: [
                  {
                    from: opts.waId,
                    id: wamid,
                    timestamp: String(opts.timestamp ?? Math.floor(Date.now() / 1000)),
                    type,
                    ...(type === "text" ? { text: { body: opts.text } } : {}),
                    ...(opts.extra ?? {}),
                  },
                ],
              },
            },
          ],
        },
      ],
    },
  };
}

export function statusPayload(opts: { wamid: string; status: string; recipient: string; timestamp?: number; errors?: unknown[] }) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_ID",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "5493870000000", phone_number_id: TEST_PHONE_NUMBER_ID },
              statuses: [
                {
                  id: opts.wamid,
                  status: opts.status,
                  timestamp: String(opts.timestamp ?? Math.floor(Date.now() / 1000)),
                  recipient_id: opts.recipient,
                  ...(opts.errors ? { errors: opts.errors } : {}),
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

export function signed(body: unknown, secret = TEST_APP_SECRET): { rawBody: string; signature: string } {
  const rawBody = JSON.stringify(body);
  return { rawBody, signature: computeSignature(rawBody, secret) };
}

export const whatsappEnv = (overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv =>
  ({
    NODE_ENV: "test",
    WHATSAPP_APP_SECRET: TEST_APP_SECRET,
    WHATSAPP_PHONE_NUMBER_ID: TEST_PHONE_NUMBER_ID,
    WHATSAPP_ACCESS_TOKEN: "test-token-no-real",
    APP_URL: "https://www.example.test",
    ...overrides,
  }) as NodeJS.ProcessEnv;
