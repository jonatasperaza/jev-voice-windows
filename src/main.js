'use strict';

require('dotenv').config();

const path = require('path');
const { app, BrowserWindow, Tray, Menu, globalShortcut, screen, nativeImage } = require('electron');

const { WhisperSpeechRecognizer } = require('./audio/whisperSpeech');
const { splitClauses } = require('./jev/clauseSplitter');
const { JevClient } = require('./jev/client');
const { getFrontmostWindow, getInstalledApps } = require('./windows/context');
const { matchKnownSite } = require('./jev/knownSites');
const executor = require('./windows/executor');

const HOTKEY = process.env.PUSH_TO_TALK_HOTKEY || 'Control+Space';

let overlayWindow = null;
let tray = null;
let speech = null;
let jev = null;
let busy = false;

function createOverlay() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;

  overlayWindow = new BrowserWindow({
    width: 360,
    height: 64,
    x: Math.round((width - 360) / 2),
    y: 24,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    focusable: false,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'overlay', 'preload.js'),
      contextIsolation: true,
    },
  });

  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.loadFile(path.join(__dirname, 'overlay', 'overlay.html'));
}

function setOverlayStatus(status, detail = '') {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  overlayWindow.webContents.send('status', { status, detail });
}

function createTray() {
  const icon = nativeImage.createFromPath(
    path.join(__dirname, '..', 'assets', 'icon.png')
  );
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('Jev Voice Windows');

  const menu = Menu.buildFromTemplate([
    { label: `Hotkey: ${HOTKEY}`, enabled: false },
    { type: 'separator' },
    { label: 'Sair', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

async function onHotkey() {
  if (busy) return;
  busy = true;
  setOverlayStatus('listening');

  try {
    const transcript = await speech.listenOnce();
    if (!transcript) {
      setOverlayStatus('idle');
      return;
    }
    setOverlayStatus('thinking', transcript);
    await handleTranscript(transcript);
  } catch (err) {
    console.error('[main] erro no pipeline:', err);
    setOverlayStatus('error', err.message);
    setTimeout(() => setOverlayStatus('idle'), 2500);
  } finally {
    busy = false;
  }
}

async function handleTranscript(transcript) {
  const clauses = splitClauses(transcript);
  if (!clauses.length) {
    setOverlayStatus('idle');
    return;
  }

  const [{ processName: frontmostApp, windowTitle: frontmostWindowTitle }, installedApps] = await Promise.all([
    getFrontmostWindow(),
    getInstalledApps(),
  ]);

  for (const clause of clauses) {
    try {
      const { decision, confidence, belowThreshold } = await jev.decide({
        clause,
        fullTranscript: transcript,
        frontmostApp,
        frontmostWindowTitle,
        installedApps,
      });

      if (belowThreshold) {
        console.warn(`[jev] confianca baixa (${confidence.toFixed(2)}) para: "${clause}" — ignorando.`);
        setOverlayStatus('error', `Nao tenho certeza: "${clause}"`);
        continue;
      }

      // O Jev so devolve respostas categoricas: se pediu pra abrir um
      // app/site mas nao achou nada entre os instalados, tenta um site
      // conhecido (instagram, x, youtube, etc.) antes de desistir.
      const action = decision.action?.value;
      if ((action === 'open_app' || action === 'open_url') && !decision.target_app?.value) {
        const url = matchKnownSite(clause);
        if (url) {
          setOverlayStatus('executing', clause);
          await executor.openUrl(url);
          continue;
        }
      }

      setOverlayStatus('executing', clause);
      await executor.execute(decision);
    } catch (err) {
      const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
      console.error(`[main] falha ao processar clausula "${clause}":`, detail);
      setOverlayStatus('error', err.message);
    }
  }

  setOverlayStatus('done');
  setTimeout(() => setOverlayStatus('idle'), 1500);
}

app.whenReady().then(async () => {
  try {
    speech = new WhisperSpeechRecognizer({
      language: process.env.SPEECH_LANGUAGE || 'pt-BR',
      maxListenSeconds: Number(process.env.SPEECH_MAX_SECONDS || 12),
      initialSilenceSeconds: Number(process.env.SPEECH_INITIAL_SILENCE_SECONDS || 6),
      endSilenceSeconds: Number(process.env.SPEECH_END_SILENCE_SECONDS || 1.2),
    });
    jev = new JevClient({
      apiKey: process.env.TYPESAFE_API_KEY,
      timeoutMs: Number(process.env.JEV_TIMEOUT_MS || 15000),
    });
  } catch (err) {
    console.error('[main] configuracao invalida:', err.message);
    console.error('Verifique o arquivo .env (veja .env.example).');
    app.quit();
    return;
  }

  createOverlay();
  createTray();
  setOverlayStatus('loading');

  try {
    await speech.ready();
  } catch (err) {
    console.error('[main] falha ao iniciar o motor de voz (whisper):', err.message);
    setOverlayStatus('error', err.message);
  }
  setOverlayStatus('idle');

  const ok = globalShortcut.register(HOTKEY, onHotkey);
  if (!ok) {
    console.error(`[main] nao foi possivel registrar o hotkey global: ${HOTKEY}`);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createOverlay();
  });
});

app.on('window-all-closed', (e) => {
  // Mantem o app vivo na bandeja mesmo sem janelas visiveis.
  e.preventDefault();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (speech) speech.dispose();
});
