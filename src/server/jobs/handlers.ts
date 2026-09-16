/**
 * Punto único donde se registran handlers de jobs y acciones de automatización.
 * Cada módulo agrega su import acá (los módulos se registran al importarse).
 */
import "../automation/base-actions";
import "../automation/engine";
import "./scheduled";
import "../rentals/jobs";
