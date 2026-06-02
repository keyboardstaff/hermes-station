import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Browser SpeechSynthesis (text-to-speech) wrapper — the playback counterpart
 * to `useVoiceInput` (STT). Speech synthesis is a single global queue, so
 * `speak()` cancels any in-flight utterance first; only one message speaks at a
 * time. Degrades to `supported: false` where the API is absent (e.g. jsdom).
 */
export function useTextToSpeech() {
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  const [speaking, setSpeaking] = useState(false);
  // Mirror of `speaking` for the unmount cleanup (so it only cancels OUR speech,
  // not another bubble's, without re-running the effect on every toggle).
  const speakingRef = useRef(false);

  const setSpeakingBoth = useCallback((v: boolean) => {
    speakingRef.current = v;
    setSpeaking(v);
  }, []);

  const speak = useCallback((text: string) => {
    if (!supported || !text.trim()) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.onend = () => setSpeakingBoth(false);
    u.onerror = () => setSpeakingBoth(false);
    setSpeakingBoth(true);
    window.speechSynthesis.speak(u);
  }, [supported, setSpeakingBoth]);

  const stop = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    setSpeakingBoth(false);
  }, [supported, setSpeakingBoth]);

  // Stop our own audio on unmount so it doesn't outlive the bubble.
  useEffect(() => () => {
    if (supported && speakingRef.current) window.speechSynthesis.cancel();
  }, [supported]);

  return { supported, speaking, speak, stop };
}
