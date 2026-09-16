/**
 * Punto único donde se registran handlers de jobs y acciones de automatización.
 * Cada módulo agrega su import acá (los módulos se registran al importarse).
 */
import "../automation/base-actions";
import "../automation/engine";
import "./scheduled";
import "../messaging/send";
import "../messaging/internal-actions";
import "../integrations/portals/sync";
import "../marketing/drafts";
import "../marketing/publish";
import "../media/copy";
