/** Composer queue drain logic — auto-drain on settle, send-now, in-queue edit.
 *  Extracted from Composer.tsx so the state-heavy queue management is
 *  testable without the full composer surface (same rationale as run-events.ts). */
import { useState, useRef, useMemo, useCallback, useEffect } from "react";
import type { ComposerAttachment } from "@/lib/hermes-types";
import {
  useComposerQueue,
  queuedPromptsFor,
  shouldAutoDrainOnSettle,
  type QueuedPromptEntry,
} from "@/store/composer-queue";

interface UseComposerDrainParams {
  sessionId?: string | null;
  isRunning: boolean;
  onSend: (text: string, attachments?: ComposerAttachment[]) => void | Promise<unknown>;
  onStop: () => void;
  setValue: React.Dispatch<React.SetStateAction<string>>;
  textRef: React.RefObject<HTMLTextAreaElement | null>;
}

export function useComposerDrain({
  sessionId,
  isRunning,
  onSend,
  onStop,
  setValue,
  textRef,
}: UseComposerDrainParams) {
  const [queueEditId, setQueueEditId] = useState<string | null>(null);
  const queueEditIdRef = useRef(queueEditId);
  queueEditIdRef.current = queueEditId;
  const drainingRef = useRef(false);
  const prevBusyRef = useRef(isRunning);

  const queuesBySession = useComposerQueue((s) => s.queuesBySession);
  const enqueueQueued = useComposerQueue((s) => s.enqueue);
  const removeQueued = useComposerQueue((s) => s.remove);
  const promoteQueued = useComposerQueue((s) => s.promote);
  const updateQueuedText = useComposerQueue((s) => s.updateText);

  const queued = useMemo(
    () => queuedPromptsFor(queuesBySession, sessionId),
    [queuesBySession, sessionId],
  );

  // Session switch → drop any in-progress edit.
  useEffect(() => { setQueueEditId(null); }, [sessionId]);
  useEffect(() => {
    if (queueEditId && !queued.some((e) => e.id === queueEditId)) setQueueEditId(null);
  }, [queued, queueEditId]);

  const drainNext = useCallback(async (pickId?: string) => {
    if (drainingRef.current || !sessionId) return;
    const list = queuedPromptsFor(useComposerQueue.getState().queuesBySession, sessionId);
    const entry = pickId
      ? list.find((e) => e.id === pickId)
      : list.find((e) => e.id !== queueEditIdRef.current);
    if (!entry) return;
    drainingRef.current = true;
    try {
      await Promise.resolve(
        onSend(entry.text, entry.attachments.length > 0 ? entry.attachments : undefined),
      );
      removeQueued(sessionId, entry.id);
    } finally {
      drainingRef.current = false;
    }
  }, [sessionId, onSend, removeQueued]);

  // Auto-drain on busy → false (turn settled — natural finish or interrupt).
  useEffect(() => {
    const wasBusy = prevBusyRef.current;
    prevBusyRef.current = isRunning;
    if (shouldAutoDrainOnSettle({ wasBusy, isBusy: isRunning, queueLength: queued.length })) {
      void drainNext();
    }
  }, [isRunning, queued.length, drainNext]);

  const sendQueuedNow = useCallback((id: string) => {
    if (id === queueEditIdRef.current) return;
    if (isRunning) {
      // Promote to head, then interrupt — the settle auto-drain sends it.
      promoteQueued(sessionId, id);
      onStop();
      return;
    }
    void drainNext(id);
  }, [isRunning, promoteQueued, sessionId, onStop, drainNext]);

  const beginQueueEdit = useCallback((entry: QueuedPromptEntry) => {
    setQueueEditId(entry.id);
    setValue(entry.text);
    requestAnimationFrame(() => textRef.current?.focus());
  }, [setValue, textRef]);

  return {
    queueEditId,
    setQueueEditId,
    queued,
    enqueueQueued,
    removeQueued,
    updateQueuedText,
    drainNext,
    sendQueuedNow,
    beginQueueEdit,
  };
}
