'use strict';

const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

let _appsCache = null;
let _appsCacheAt = 0;
const APPS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min, a lista muda pouco

// Roda script via -EncodedCommand (base64 utf16le) em vez de -Command com
// o script inline: evita todo problema de escaping de aspas/here-strings
// quando o script passa pelo cmd.exe (shell padrao do exec no Windows)
// antes de chegar no PowerShell.
async function runPowerShellScript(script, opts = {}) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return execAsync(
    `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encoded}`,
    { windowsHide: true, ...opts }
  );
}

async function getFrontmostWindow() {
  const script = `
    Add-Type @"
      using System;
      using System.Runtime.InteropServices;
      using System.Text;
      public class Win32 {
        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
        [DllImport("user32.dll", CharSet = CharSet.Auto)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
      }
"@
    $hwnd = [Win32]::GetForegroundWindow()
    $procId = 0
    [Win32]::GetWindowThreadProcessId($hwnd, [ref]$procId) | Out-Null
    $sb = New-Object System.Text.StringBuilder 512
    [Win32]::GetWindowText($hwnd, $sb, $sb.Capacity) | Out-Null
    [PSCustomObject]@{
      ProcessName = (Get-Process -Id $procId).ProcessName
      WindowTitle = $sb.ToString()
    } | ConvertTo-Json -Compress
  `;

  try {
    const { stdout } = await runPowerShellScript(script, { timeout: 3000 });
    const parsed = JSON.parse(stdout);
    return {
      processName: parsed.ProcessName || null,
      windowTitle: parsed.WindowTitle || null,
    };
  } catch (err) {
    console.error('[context] falha ao obter janela em foco:', err.message);
    return { processName: null, windowTitle: null };
  }
}

async function getInstalledApps({ forceRefresh = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && _appsCache && now - _appsCacheAt < APPS_CACHE_TTL_MS) {
    return _appsCache;
  }

  try {
    const { stdout } = await runPowerShellScript('Get-StartApps | ConvertTo-Json -Compress', {
      timeout: 5000,
      maxBuffer: 10 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    _appsCache = list.map((a) => a.Name).filter(Boolean);
    _appsCacheAt = now;
    return _appsCache;
  } catch (err) {
    console.error('[context] falha ao listar apps instalados:', err.message);
    return _appsCache || [];
  }
}

module.exports = { getFrontmostWindow, getInstalledApps };
