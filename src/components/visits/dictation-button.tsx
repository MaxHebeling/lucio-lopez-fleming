"use client";

/**
 * Dictado con la Web Speech API del navegador, solo como entrada de texto: la app no graba ni envía audio.
 * El reconocimiento lo hace el navegador (según el navegador puede procesarse en el dispositivo o en el servicio de
 * voz del fabricante: docs/operations/PRIVACY_LOCATION.md). Si no existe la API, el botón no aparece (el teclado del
 * teléfono igual permite dictar).
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";

type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
type RecognitionEvent = { resultIndex: number; results: ArrayLike<RecognitionResult> };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const ERRORS: Record<string, string> = {
  "not-allowed": "Permití el micrófono para dictar (o usá el teclado del teléfono).",
  "service-not-allowed": "El navegador no permite dictado en esta página.",
  "no-speech": "No se escuchó nada. Probá de nuevo.",
  network: "El dictado del navegador necesita conexión.",
  "audio-capture": "No se encontró micrófono.",
};

export function DictationButton({ onText, controls }: { onText: (text: string) => void; controls: string }) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);

  useEffect(() => {
    // Se detecta en el cliente (en el servidor no hay window): evita diferencias de hidratación.
    const id = window.setTimeout(() => setSupported(Boolean(recognitionCtor())), 0);
    return () => {
      window.clearTimeout(id);
      rec.current?.stop();
    };
  }, []);

  if (!supported) return null;

  const toggle = () => {
    if (listening) {
      rec.current?.stop();
      return;
    }
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = "es-AR";
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e) => {
      let text = "";
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i]!.isFinal) text += e.results[i]![0].transcript;
      if (text.trim()) onText(text.trim());
    };
    r.onerror = (e) => {
      if (e.error !== "aborted") setError(ERRORS[e.error] ?? "El dictado se interrumpió. Probá de nuevo.");
    };
    r.onend = () => setListening(false);
    rec.current = r;
    setError(null);
    r.start();
    setListening(true);
  };

  return (
    <span className="inline-flex flex-col gap-1">
      <Button variant={listening ? "danger" : "secondary"} className="h-11" onClick={toggle} aria-pressed={listening} aria-controls={controls}>
        <span aria-hidden="true">🎙️</span> {listening ? "Detener dictado" : "Dictar"}
      </Button>
      {listening ? (
        <span role="status" className="text-xs text-stone">
          Escuchando… el texto se agrega al comentario.
        </span>
      ) : null}
      {error ? (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      ) : null}
    </span>
  );
}
