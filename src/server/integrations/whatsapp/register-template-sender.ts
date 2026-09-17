/** Conecta la cola genérica de mensajes (messaging.send) con el envío de plantillas aprobadas de WhatsApp. */
import { registerWhatsAppTemplateSender } from "../../messaging/whatsapp-bridge";
import { sendWhatsAppTemplate } from "./template-sender";

registerWhatsAppTemplateSender((db, message) => sendWhatsAppTemplate(db, message));
