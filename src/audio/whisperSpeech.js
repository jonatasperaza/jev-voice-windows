'use strict';

/**
 * Reconhecimento de voz local via faster-whisper (Python), rodando na
 * GPU quando disponivel (CUDA). O processo Python fica vivo o app
 * inteiro — o modelo Whisper e carregado uma unica vez no boot — e o
 * Node conversa com ele por stdin/stdout em linhas JSON (ver
 * python/whisper_worker.py para o protocolo).
 *
 * Substitui o antigo caminho via PowerShell/SAPI: sem depender de
 * idioma de exibicao do Windows nem de aceitar politica de privacidade
 * de fala online — tudo roda offline, na maquina.
 */

const path = require('path');
const { spawn } = require('child_process');

class WhisperSpeechRecognizer {
  constructor({
    language = 'pt-BR',
    maxListenSeconds = 12,
    initialSilenceSeconds = 6,
    endSilenceSeconds = 1.2,
    pythonPath = process.env.WHISPER_PYTHON || 'python',
  } = {}) {
    this.language = language.split('-')[0].toLowerCase();
    this.maxListenSeconds = maxListenSeconds;
    this.initialSilenceSeconds = initialSilenceSeconds;
    this.endSilenceSeconds = endSilenceSeconds;

    const workerPath = path.join(__dirname, '..', '..', 'python', 'whisper_worker.py');
    this.proc = spawn(pythonPath, ['-u', workerPath], { windowsHide: true });

    this.queue = [];
    this._readySettled = false;
    this.readyPromise = new Promise((resolve, reject) => {
      this._resolveReady = resolve;
      this._rejectReady = reject;
    });

    let buffer = '';
    this.proc.stdout.on('data', (data) => {
      buffer += data.toString('utf8');
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line) this._handleLine(line);
      }
    });

    this.proc.stderr.on('data', (data) => {
      console.error('[whisper]', data.toString('utf8').trim());
    });

    this.proc.on('error', (err) => {
      this._fail(new Error(`nao foi possivel iniciar o python ("${pythonPath}"): ${err.message}`));
    });

    this.proc.on('exit', (code) => {
      this._fail(new Error(`processo whisper encerrado (codigo ${code})`));
    });
  }

  _fail(err) {
    if (!this._readySettled) {
      this._readySettled = true;
      this._rejectReady(err);
    }
    while (this.queue.length) this.queue.shift().reject(err);
  }

  _handleLine(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }

    if (msg.ready) {
      this._readySettled = true;
      this._resolveReady();
      return;
    }

    if (msg.log) return; // logs vao pro stderr, nao deveria cair aqui, mas ignora por seguranca

    const pending = this.queue.shift();
    if (!pending) return;

    if (msg.error) pending.reject(new Error(msg.error));
    else pending.resolve(msg.text || '');
  }

  /** Resolve quando o modelo terminou de carregar e o worker esta pronto. */
  async ready() {
    return this.readyPromise;
  }

  /**
   * Escuta o microfone padrao ate reconhecer uma frase (ou estourar o
   * timeout) e retorna o texto transcrito ("" se nada foi reconhecido).
   */
  async listenOnce() {
    await this.readyPromise;
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject });
      this.proc.stdin.write(
        JSON.stringify({
          cmd: 'listen',
          language: this.language,
          maxListenSeconds: this.maxListenSeconds,
          initialSilenceSeconds: this.initialSilenceSeconds,
          endSilenceSeconds: this.endSilenceSeconds,
        }) + '\n'
      );
    });
  }

  dispose() {
    if (this.proc && !this.proc.killed) this.proc.kill();
  }
}

module.exports = { WhisperSpeechRecognizer };
