import { useCallback, useEffect, useRef, useState } from "react";

// Web Speech API voice input, extracted from Composer.

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>>; resultIndex: number }) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Push-to-toggle dictation. `onTranscript` receives each recognised chunk; the
 * caller decides how to merge it into the input. Releases the mic on unmount.
 */
export function useVoiceInput(onTranscript: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // Keep the latest callback without re-creating `toggle` on every keystroke.
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const stop = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) return;
    rec.onresult = null;
    rec.onerror = null;
    rec.onend = null;
    try {
      rec.stop();
    } catch { /* already stopped */ }
    recognitionRef.current = null;
    setListening(false);
  }, []);

  // Release microphone on unmount.
  useEffect(() => () => stop(), [stop]);

  const toggle = useCallback(() => {
    const Ctor = getSpeechRecognition();
    if (!Ctor) return;
    if (listening) {
      stop();
      return;
    }
    try {
      const rec = new Ctor();
      rec.lang = navigator.language || "en-US";
      rec.continuous = false;
      rec.interimResults = true;
      rec.onresult = (ev) => {
        let transcript = "";
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          transcript += ev.results[i][0].transcript;
        }
        onTranscriptRef.current(transcript);
      };
      rec.onerror = () => setListening(false);
      rec.onend = () => {
        setListening(false);
        recognitionRef.current = null;
      };
      recognitionRef.current = rec;
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }, [listening, stop]);

  return { supported: getSpeechRecognition() !== null, listening, toggle };
}
