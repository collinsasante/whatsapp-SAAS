'use client';
import { useRef, useCallback } from 'react';
import { mediaApi, callsApi } from '@/lib/api';

function bestMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

export async function uploadCallRecording(callLogId: string, blob: Blob): Promise<void> {
  try {
    const mimeType = blob.type || 'audio/webm';
    const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm';
    const file = new File([blob], `call-${callLogId}.${ext}`, { type: mimeType });
    const res = await mediaApi.upload(file);
    const { fileUrl } = res.data as { fileUrl: string };
    await callsApi.update(callLogId, { recordingUrl: fileUrl });
  } catch (err) {
    console.warn('[CallRecording] upload failed:', err);
  }
}

export function useCallRecording() {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef   = useRef<Blob[]>([]);
  const ctxRef      = useRef<AudioContext | null>(null);

  const isRecording = useCallback(() =>
    recorderRef.current !== null && recorderRef.current.state !== 'inactive',
  []);

  const start = useCallback((localStream: MediaStream | null, remoteStream: MediaStream | null) => {
    if (typeof MediaRecorder === 'undefined') return;
    if (recorderRef.current) return; // already recording
    try {
      const AudioCtxClass = window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtxClass();
      ctxRef.current = ctx;
      const dest = ctx.createMediaStreamDestination();
      if (localStream)  ctx.createMediaStreamSource(localStream).connect(dest);
      if (remoteStream) ctx.createMediaStreamSource(remoteStream).connect(dest);
      const mimeType = bestMimeType();
      const recorder = new MediaRecorder(dest.stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.start(1000);
      recorderRef.current = recorder;
    } catch (err) {
      console.warn('[CallRecording] start failed:', err);
    }
  }, []);

  const stop = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const recorder = recorderRef.current;
      if (!recorder || recorder.state === 'inactive') { resolve(null); return; }
      recorder.onstop = () => {
        const mime = recorder.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: mime });
        chunksRef.current = [];
        recorderRef.current = null;
        if (ctxRef.current) {
          try { void ctxRef.current.close(); } catch { /* ignore */ }
          ctxRef.current = null;
        }
        resolve(blob.size > 1024 ? blob : null);
      };
      try { recorder.stop(); } catch { resolve(null); }
    });
  }, []);

  return { start, stop, isRecording };
}
