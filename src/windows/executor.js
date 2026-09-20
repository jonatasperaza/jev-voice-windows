'use strict';

/**
 * Executa as acoes decididas pelo Jev no Windows.
 *
 * Todas as acoes usam PowerShell / utilitarios nativos do Windows, sem
 * dependencias nativas compiladas:
 *  - abrir apps: Start-Process (tenta shell:AppsFolder para apps UWP)
 *  - abrir URLs: Start-Process <url>
 *  - digitar texto / teclas: SendKeys via System.Windows.Forms
 *  - acoes de sistema: comandos especificos (lock, sleep, volume, etc.)
 */

const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

function runPowerShell(script, { timeout = 5000 } = {}) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return execAsync(
    `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
    { windowsHide: true, timeout }
  );
}

/** Escapa uma string para uso seguro dentro de aspas simples do PowerShell. */
function psQuote(str) {
  return String(str).replace(/'/g, "''");
}

/** Escapa uma string para SendKeys (chaves especiais {}, +, ^, %, ~, ()). */
function sendKeysEscape(str) {
  return String(str).replace(/([+^%~(){}[\]])/g, '{$1}');
}

async function openApp(appName) {
  // Tenta primeiro achar o atalho pelo nome amigavel (Get-StartApps) e
  // abrir via AppID; se falhar, cai para Start-Process com o nome cru.
  const script = `
    $app = Get-StartApps | Where-Object { $_.Name -like '*${psQuote(appName)}*' } | Select-Object -First 1
    if ($app) {
      Start-Process "shell:AppsFolder\\$($app.AppID)"
    } else {
      Start-Process '${psQuote(appName)}'
    }
  `;
  await runPowerShell(script);
}

async function openUrl(url) {
  const safeUrl = url.startsWith('http') ? url : `https://${url}`;
  await runPowerShell(`Start-Process '${psQuote(safeUrl)}'`);
}

async function typeText(text) {
  const script = `
    Add-Type -AssemblyName System.Windows.Forms
    Start-Sleep -Milliseconds 150
    [System.Windows.Forms.SendKeys]::SendWait('${psQuote(sendKeysEscape(text))}')
  `;
  await runPowerShell(script);
}

/**
 * Envia uma combinacao de teclas em formato SendKeys ja pronto
 * (ex: '^s' para Ctrl+S, '%{F4}' para Alt+F4).
 */
async function keystroke(sendKeysCombo) {
  const script = `
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.SendKeys]::SendWait('${sendKeysCombo.replace(/'/g, "''")}')
  `;
  await runPowerShell(script);
}

const SYSTEM_ACTIONS = {
  lock: () => runPowerShell('rundll32.exe user32.dll,LockWorkStation'),
  sleep: () => runPowerShell('rundll32.exe powrprof.dll,SetSuspendState 0,1,0'),
  screenshot: () =>
    runPowerShell(
      "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('{PRTSC}')"
    ),
  mute: () =>
    runPowerShell(
      "(New-Object -ComObject WScript.Shell).SendKeys([char]173)"
    ),
  volume_up: () =>
    runPowerShell(
      "(New-Object -ComObject WScript.Shell).SendKeys([char]175)"
    ),
  volume_down: () =>
    runPowerShell(
      "(New-Object -ComObject WScript.Shell).SendKeys([char]174)"
    ),
};

async function runSystemAction(action) {
  const fn = SYSTEM_ACTIONS[action];
  if (!fn) throw new Error(`Acao de sistema desconhecida: ${action}`);
  await fn();
}

/**
 * Ponto de entrada unico: recebe a decisao tipada do Jev e executa a
 * acao correspondente.
 */
async function execute(decision) {
  // Cada entrada de decision e sempre {value, confidence} (ver
  // JevClient.decide). Nao usar `?? decision.X` como fallback: quando
  // value e legitimamente null/false, isso cairia pro objeto inteiro
  // {value, confidence} em vez do valor real.
  const action = decision.action?.value;

  switch (action) {
    case 'open_app': {
      const target = decision.target_app?.value;
      if (!target) throw new Error('Nao encontrei esse app entre os instalados.');
      return openApp(target);
    }
    case 'open_url': {
      const target = decision.target_app?.value;
      if (!target) throw new Error('open_url sem alvo');
      return openUrl(target);
    }
    case 'type_text': {
      const text = decision.text?.value;
      if (!text) throw new Error('type_text sem texto');
      return typeText(text);
    }
    case 'keystroke': {
      const combo = decision.keys?.value;
      if (!combo) throw new Error('keystroke sem combinacao');
      return keystroke(combo);
    }
    case 'system_action': {
      const sysAction = decision.system_action?.value;
      return runSystemAction(sysAction);
    }
    default:
      throw new Error(`Acao nao suportada ou desconhecida: ${action}`);
  }
}

module.exports = { execute, openApp, openUrl, typeText, keystroke, runSystemAction };
