/**
 * web-client/src/lib/voice.js
 *
 * Client-side voice recorder for form filling.
 * Captures microphone PCM via the Web Audio API, encodes 16 kHz mono WAV and
 * POSTs it to the server-side /api/fieldops/voice/transcribe route (Gemini).
 * No audio is persisted; the Google LLM key never reaches the client.
 */
import { useState } from "react";
import { getApiBaseUrl } from "../config.js";
import { currentToken } from "./pb.js";

const AUDIO_CAP = { maxSeconds: 20, maxBytes: 2 * 1024 * 1024 };

function floatTo16BitPCM(input) {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    let s = Math.max(-1, Math.min(1, input[i]));
    s = s < 0 ? s * 0x8000 : s * 0x7fff;
    out[i] = s;
  }
  return out;
}

function downsample16k(buffer, inputSampleRate) {
  if (inputSampleRate === 16000) return buffer;
  const ratio = inputSampleRate / 16000;
  const out = new Float32Array(Math.floor(buffer.length / ratio));
  let idx = 0;
  for (let i = 0; i < buffer.length; i += ratio) {
    out[idx++] = buffer[Math.floor(i)];
  }
  return out;
}

function encodeWAV(samples16k, sampleRate = 16000) {
  const bytes = samples16k.length * 2;
  const buffer = new ArrayBuffer(44 + bytes);
  const view = new DataView(buffer);
  const writeString = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + bytes, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, bytes, true);
  for (let i = 0; i < samples16k.length; i++) view.setInt16(44 + i * 2, samples16k[i], true);
  return buffer;
}

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export class VoiceRecorder {
  constructor() {
    this.stream = null;
    this.ctx = null;
    this.processor = null;
    this.source = null;
    this.chunks = [];
    this.sampleRate = 44100;
    this.recording = false;
  }

  async start() {
    if (this.recording) return;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.sampleRate = this.ctx.sampleRate;
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (e) => {
      this.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    };
    source.connect(this.processor);
    this.processor.connect(this.ctx.destination);
    this.source = source;
    this.recording = true;
    this.chunks = [];
    await this.ctx.resume();
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.recording) { resolve(null); return; }
      this.recording = false;
      try {
        if (this.processor) { this.processor.onaudioprocess = null; this.processor.disconnect(); }
        if (this.source) this.source.disconnect();
        if (this.ctx) this.ctx.close();
      } catch (err) { /* ignore */ }
      if (this.stream) {
        this.stream.getTracks().forEach((t) => t.stop());
        this.stream = null;
      }
      const pcm = this.chunks.length
        ? Float32Array.from(this.chunks.reduce((acc, c) => acc.concat(Array.from(c)), []))
        : new Float32Array(0);
      const down = downsample16k(pcm, this.sampleRate);
      const pcm16 = floatTo16BitPCM(down);
      const wav = encodeWAV(pcm16, 16000);
      const b64 = arrayBufferToBase64(wav);
      resolve({ audioBase64: b64, mimeType: "audio/wav", bytes: wav.byteLength });
    });
  }
}

export function voiceSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia &&
    (window.AudioContext || window.webkitAudioContext));
}

export async function transcribeAudio({ audioBase64, mimeType = "audio/wav", language = "auto", mode = "dictate", context = {} }) {
  const base = getApiBaseUrl();
  const res = await fetch(base + "/api/fieldops/voice/transcribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionToken: currentToken(), audioBase64, mimeType, language, mode, context })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.code || "Voice transcription failed (HTTP " + res.status + ").");
  }
  return res.json();
}

export function useVoiceTranscribe({ language = "auto", mode = "dictate" } = {}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const transcribe = async (audio) => {
    setBusy(true);
    setError(null);
    try {
      const res = await transcribeAudio({ ...audio, language, mode });
      setBusy(false);
      return res;
    } catch (err) {
      setBusy(false);
      setError(err.message);
      return null;
    }
  };
  return { transcribe, busy, error };
}
