/**
 * Recall Audio Bridge - Bridges Recall.ai meeting audio ↔ ElevenLabs Conversational AI
 *
 * Flow:
 *   Meeting audio (PCM 16kHz via Recall WebSocket)
 *     → Forward to ElevenLabs Conversational AI WebSocket
 *     → ElevenLabs processes (STT → Custom LLM → TTS)
 *     → Receive TTS audio back (PCM 16kHz)
 *     → POST to Recall.ai output_audio endpoint
 *     → Meeting participants hear Coppice
 *
 * Echo suppression: While sending TTS back to Recall, silence is sent to
 * ElevenLabs to prevent it from hearing its own voice.
 */

import { WebSocket } from 'ws';
import { spawn } from 'child_process';
import { getConversationalAgentUrl } from './elevenlabsService.js';
import { sendAudio } from './recallService.js';

const ELEVENLABS_AGENT_ID = process.env.ELEVENLABS_AGENT_ID || '';

export class RecallAudioBridge {
  constructor(botId, opts = {}) {
    this.botId = botId;
    this.agentId = opts.agentId || ELEVENLABS_AGENT_ID;
    this._elWs = null;
    this._speaking = false;
    this._running = false;
    this._ttsChunks = [];
    this._flushTimer = null;
    // Buffer incoming PCM and forward in batches to reduce overhead
    this._pcmBuffer = Buffer.alloc(0);
    this._pcmFlushInterval = null;
  }

  /**
   * Start the bridge - connect to ElevenLabs Conversational AI.
   */
  async start() {
    if (!this.agentId) {
      throw new Error('ELEVENLABS_AGENT_ID not configured - cannot start audio bridge');
    }

    this._running = true;

    // Get signed WebSocket URL from ElevenLabs
    const signedUrl = await getConversationalAgentUrl(this.agentId);
    console.log(`[AudioBridge] Connecting to ElevenLabs for bot ${this.botId}...`);

    this._elWs = new WebSocket(signedUrl);

    this._elWs.on('open', () => {
      console.log(`[AudioBridge] ElevenLabs connected for bot ${this.botId}`);
      // Start PCM flush interval - forward buffered audio every 100ms
      this._pcmFlushInterval = setInterval(() => this._flushPcmBuffer(), 100);
    });

    this._elWs.on('message', (data) => {
      this._handleElevenLabsMessage(data);
    });

    this._elWs.on('close', (code, reason) => {
      console.log(`[AudioBridge] ElevenLabs disconnected for bot ${this.botId}: ${code} ${reason}`);
      this._cleanup();
    });

    this._elWs.on('error', (err) => {
      console.error(`[AudioBridge] ElevenLabs WebSocket error for bot ${this.botId}:`, err.message);
    });
  }

  /**
   * Handle incoming audio from Recall.ai (meeting participants speaking).
   * Called by the WebSocket handler in index.js when Recall sends audio chunks.
   *
   * @param {Buffer} pcmData - Raw PCM 16-bit signed LE, 16kHz mono
   */
  handleAudioChunk(pcmData) {
    if (!this._running) return;

    // During echo suppression (bot is speaking), don't forward audio
    if (this._speaking) return;

    // Append to buffer - will be flushed to ElevenLabs on interval
    this._pcmBuffer = Buffer.concat([this._pcmBuffer, pcmData]);
  }

  /**
   * Flush buffered PCM audio to ElevenLabs.
   */
  _flushPcmBuffer() {
    if (this._pcmBuffer.length === 0) return;
    if (!this._elWs || this._elWs.readyState !== WebSocket.OPEN) return;

    // ElevenLabs Conversational AI expects base64-encoded audio chunks
    const base64Audio = this._pcmBuffer.toString('base64');
    this._elWs.send(JSON.stringify({
      type: 'audio',
      audio: base64Audio,
    }));
    this._pcmBuffer = Buffer.alloc(0);
  }

  /**
   * Handle messages from ElevenLabs Conversational AI.
   * ElevenLabs sends back TTS audio when it has a response.
   */
  _handleElevenLabsMessage(raw) {
    try {
      const msg = JSON.parse(raw.toString());

      switch (msg.type) {
        case 'audio':
          // TTS audio chunk from ElevenLabs - collect and send to Recall
          this._ttsChunks.push(Buffer.from(msg.audio, 'base64'));
          // Debounce: wait for end-of-speech or flush after 500ms of no new chunks
          clearTimeout(this._flushTimer);
          this._flushTimer = setTimeout(() => this._flushTtsToRecall(), 500);
          break;

        case 'agent_response':
          // Agent started speaking - enable echo suppression
          this._speaking = true;
          break;

        case 'agent_response_end':
          // Agent finished speaking - disable echo suppression after a short delay
          setTimeout(() => { this._speaking = false; }, 300);
          break;

        case 'user_transcript':
          // Real-time user transcript from ElevenLabs STT
          if (msg.text) {
            console.log(`[AudioBridge] User said: "${msg.text}"`);
          }
          break;

        case 'ping':
          // Respond to keepalive
          if (this._elWs?.readyState === WebSocket.OPEN) {
            this._elWs.send(JSON.stringify({ type: 'pong' }));
          }
          break;

        default:
          // Log unknown message types for debugging
          if (msg.type !== 'audio_done') {
            console.log(`[AudioBridge] ElevenLabs message: ${msg.type}`);
          }
      }
    } catch (err) {
      // Binary audio data - might be raw PCM from older API versions
      if (Buffer.isBuffer(raw)) {
        this._ttsChunks.push(raw);
        clearTimeout(this._flushTimer);
        this._flushTimer = setTimeout(() => this._flushTtsToRecall(), 500);
      }
    }
  }

  /**
   * Flush collected TTS audio chunks to Recall.ai as MP3.
   * Recall expects MP3, so we concatenate PCM chunks and convert.
   */
  async _flushTtsToRecall() {
    if (this._ttsChunks.length === 0) return;

    const pcmBuffer = Buffer.concat(this._ttsChunks);
    this._ttsChunks = [];

    try {
      // Convert PCM 16kHz to MP3 using ffmpeg
      const mp3Buffer = await this._pcmToMp3(pcmBuffer);
      await sendAudio(this.botId, mp3Buffer);
      console.log(`[AudioBridge] Sent ${mp3Buffer.length} bytes TTS audio to Recall bot ${this.botId}`);
    } catch (err) {
      console.error(`[AudioBridge] Failed to send TTS to Recall:`, err.message);
    }

    // Disable echo suppression after audio is fully sent
    setTimeout(() => { this._speaking = false; }, 500);
  }

  /**
   * Convert raw PCM (16-bit signed LE, 16kHz, mono) to MP3 via ffmpeg.
   * @param {Buffer} pcmBuffer
   * @returns {Promise<Buffer>} MP3 buffer
   */
  _pcmToMp3(pcmBuffer) {
    return new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-f', 's16le',       // input format: signed 16-bit little-endian
        '-ar', '16000',      // sample rate
        '-ac', '1',          // mono
        '-i', 'pipe:0',      // read from stdin
        '-codec:a', 'libmp3lame',
        '-b:a', '64k',
        '-f', 'mp3',
        'pipe:1',            // write to stdout
      ], { stdio: ['pipe', 'pipe', 'ignore'] });

      const chunks = [];
      ffmpeg.stdout.on('data', (chunk) => chunks.push(chunk));
      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve(Buffer.concat(chunks));
        } else {
          reject(new Error(`ffmpeg exited with code ${code}`));
        }
      });
      ffmpeg.on('error', reject);
      ffmpeg.stdin.write(pcmBuffer);
      ffmpeg.stdin.end();
    });
  }

  /**
   * Stop the bridge - close ElevenLabs connection, cleanup.
   */
  stop() {
    console.log(`[AudioBridge] Stopping bridge for bot ${this.botId}`);
    this._running = false;
    this._cleanup();
  }

  _cleanup() {
    clearInterval(this._pcmFlushInterval);
    clearTimeout(this._flushTimer);
    this._pcmBuffer = Buffer.alloc(0);
    this._ttsChunks = [];
    if (this._elWs) {
      try { this._elWs.close(); } catch {}
      this._elWs = null;
    }
  }

  get isRunning() {
    return this._running;
  }
}

// Registry of active bridges keyed by botId
const bridges = new Map();

export function getBridge(botId) {
  return bridges.get(botId) || null;
}

export function registerBridge(botId, bridge) {
  bridges.set(botId, bridge);
}

export function removeBridge(botId) {
  const bridge = bridges.get(botId);
  if (bridge) {
    bridge.stop();
    bridges.delete(botId);
  }
}
