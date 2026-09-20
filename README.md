# Jev Voice Windows

*[Português ↓](#jev-voice-windows-pt-br)*

Control Windows by voice: speech → local transcription with
[faster-whisper](https://github.com/SYSTRAN/faster-whisper) (runs on
your GPU if you have an NVIDIA one) → typed decision from
[Jev](https://typesafe.ai) (TypeSafe AI, "System One") → action on
Windows (open app, open site, type text, keystroke, system action).

Inspired by the `jev-voice-control`, `jev-voice` and `jev-mac-voice`
projects for macOS, adapted for Windows using Electron + PowerShell (no
compiled native dependencies on the Windows side).

## How it works

```
microphone (one hotkey press starts listening)
      │  python/whisper_worker.py — faster-whisper (GPU/CUDA, CPU fallback)
      │  Python process stays alive for the whole app, model loads once
      ▼
   transcribed text (RMS endpointing: detects speech end on its own)
      │  clauseSplitter.js (splits "open notepad and type ..." into 2 parts)
      ▼
   clauses
      │  POST https://api.typesafe.ai/v1/systemone  (Jev)
      │  { model: "jev-latest", state: {...}, questions: {...} }
      ▼
   typed decision (noul/choice/score) + confidence per question
      │  if confidence >= threshold
      │  if app/site not found, tries knownSites.js (instagram, x, youtube, ...)
      ▼
   executor.js → PowerShell (Start-Process, SendKeys, etc.)
```

A transparent, always-on-top overlay shows live status (loading model,
listening, thinking, executing).

## Prerequisites

1. **Node.js** 18+ and **npm**.
2. **Python** 3.10+ with `pip` (only used for the local voice worker).
3. **NVIDIA GPU** (optional but recommended — the worker falls back to
   CPU on its own if it can't find CUDA, just slower).
4. A **Jev API key** (TypeSafe AI), from your early access.

## Install

```powershell
git clone <this-repo>
cd jev-voice-windows
npm install
copy .env.example .env
```

### Voice worker (Python)

```powershell
cd python
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt

# If you have an NVIDIA GPU, install the CUDA runtime via pip (avoids
# installing the whole CUDA Toolkit):
.venv\Scripts\pip install nvidia-cublas-cu12 nvidia-cudnn-cu12

cd ..
```

Edit `.env` (from `.env.example`) and fill in at least:

```ini
TYPESAFE_API_KEY=your_key_here
WHISPER_PYTHON=python/.venv/Scripts/python.exe
```

On first run, `faster-whisper` downloads the model weights
(`large-v3-turbo` by default, ~1.5GB) from the Hugging Face Hub and
caches them locally — this only happens once.

## Running

```powershell
npm start
```

A tray icon appears and a status bar shows up at the top of the
screen. On first run, wait for the overlay to leave "Loading voice
model" (can take ~1min loading Whisper on the GPU). Then press the
hotkey (`Ctrl+Space` by default) **once** to start listening — the
worker detects on its own when you stopped talking. Say something
like:

> "open notepad"
> "open spotify and then play music" *(each clause becomes a separate call to Jev)*
> "open instagram"
> "lock the screen"

## Supported actions today

- `open_app` — opens an installed program by name (via `Get-StartApps`)
- `open_url` — opens a known site (Instagram, X, YouTube, Gmail,
  WhatsApp Web, Netflix, TikTok, LinkedIn, GitHub, Reddit, Amazon,
  Mercado Livre, Outlook, Discord, Telegram — see `src/jev/knownSites.js`)
- `system_action` — `lock`, `sleep`, `mute`, `volume_up`, `volume_down`, `screenshot`

> **Known limitation:** `type_text` and `keystroke` exist in
> `executor.js`, but Jev (System One) only returns categorical answers
> (yes/no, pick one option, numeric score) — it doesn't generate free
> text. There's currently no reliable way to get "what text to type" or
> "which shortcut to press" out of it; these two actions barely fire
> today.

To add new apps/sites/actions: installed apps work automatically (read
from Windows); sites go in `src/jev/knownSites.js`; new system actions
go in `SYSTEM_ACTIONS` (`src/windows/executor.js`) and in the
`system_action` `criteria` (`src/jev/client.js`).

## Building an installer (.exe)

```powershell
npm run dist
```

Generates an NSIS installer in `dist/` via `electron-builder`. Add an
`.ico` icon at `assets/icon.ico` before packaging (the app runs
without it, but the installer will lack a custom icon). The Python
worker is **not** bundled automatically — the app currently expects to
find the venv at `python/.venv` next to the code.

## Project structure

```
src/
  main.js                    # Electron main process, orchestrates the flow
  audio/
    whisperSpeech.js           # Node wrapper for the Python worker (stdin/stdout request queue)
  jev/
    clauseSplitter.js          # splits compound sentences into clauses
    client.js                  # Jev API HTTP client (real schema: model/state/questions)
    knownSites.js               # local fallback for known sites (instagram, x, ...)
  windows/
    context.js                  # foreground app + window title, installed apps (PowerShell)
    executor.js                  # executes the decided actions (PowerShell)
  overlay/
    overlay.html                  # status bar UI
    preload.js                     # secure IPC bridge for the overlay
python/
  whisper_worker.py            # persistent Python process: loads the model once, listens on stdin
  requirements.txt              # faster-whisper, sounddevice, numpy
```

## Security

- The Jev API key stays only in the local `.env` (don't commit it —
  already in `.gitignore`).
- Audio is transcribed entirely on your machine (local faster-whisper)
  — no voice data leaves your PC.
- Only the text transcript (short clauses), the foreground app/window,
  and installed apps are sent to the Jev API.

## Troubleshooting

- **`Library cublas64_12.dll is not found`**: missing CUDA runtime. Run
  `python/.venv/Scripts/pip install nvidia-cublas-cu12
  nvidia-cudnn-cu12` (the worker injects those DLLs into PATH on its
  own, no need to install the full CUDA Toolkit).
- **Nothing gets recognized / takes too long**: check that the right
  microphone is set as default in `Settings → System → Sound → Input`.
  Adjust `SPEECH_INITIAL_SILENCE_SECONDS` /
  `SPEECH_END_SILENCE_SECONDS` in `.env` if it's cutting off too early
  or taking too long to respond.
- **`timeout of XXXXms exceeded` on Jev calls**: increase
  `JEV_TIMEOUT_MS` in `.env` (the payload grows with the number of
  installed apps on the machine).
- **Hotkey doesn't work**: another program might already be using that
  shortcut. Change `PUSH_TO_TALK_HOTKEY` in `.env` to a different
  combination.
- **`open_app`/`open_url` "not found"**: the app needs to show up in
  the Start menu (`Get-StartApps`) with a similar name, or the site
  needs to be in `src/jev/knownSites.js`.

---

<a id="jev-voice-windows-pt-br"></a>
# Jev Voice Windows (PT-BR)

*[English ↑](#jev-voice-windows)*

Controle o Windows por voz: fala → transcrição local com
[faster-whisper](https://github.com/SYSTRAN/faster-whisper) (roda na
sua GPU, se tiver uma NVIDIA) → decisão tipada do
[Jev](https://typesafe.ai) (TypeSafe AI, "System One") → ação no
Windows (abrir app, abrir site, digitar texto, atalho de teclado, ação
de sistema).

Inspirado nos projetos `jev-voice-control`, `jev-voice` e `jev-mac-voice`
que existem para macOS, adaptado para Windows usando Electron +
PowerShell (sem dependências nativas compiladas para o lado Windows).

## Como funciona

```
microfone (um toque no hotkey e comeca a ouvir)
      │  python/whisper_worker.py — faster-whisper (GPU/CUDA, fallback CPU)
      │  processo Python fica vivo o app inteiro, modelo carrega 1x
      ▼
   texto transcrito (endpointing por RMS: detecta sozinho onde a fala termina)
      │  clauseSplitter.js (separa "abra o notepad e digite ..." em 2 partes)
      ▼
   clausulas
      │  POST https://api.typesafe.ai/v1/systemone  (Jev)
      │  { model: "jev-latest", state: {...}, questions: {...} }
      ▼
   decisão tipada (noul/choice/score) + confiança por pergunta
      │  se confiança >= limiar
      │  se app/site nao encontrado, tenta knownSites.js (instagram, x, youtube, ...)
      ▼
   executor.js → PowerShell (Start-Process, SendKeys, etc.)
```

Um overlay transparente e sempre-no-topo mostra o status em tempo real
(carregando modelo, ouvindo, pensando, executando).

## Pré-requisitos

1. **Node.js** 18+ e **npm**.
2. **Python** 3.10+ com `pip` (usado só para o worker de voz local).
3. **GPU NVIDIA** (opcional, mas recomendado — o worker cai para CPU
   sozinho se não achar CUDA, só fica mais lento).
4. Uma **API key do Jev** (TypeSafe AI), do seu early access.

## Instalação

```powershell
git clone <este-repo>
cd jev-voice-windows
npm install
copy .env.example .env
```

### Worker de voz (Python)

```powershell
cd python
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt

# Se voce tem GPU NVIDIA, instale o runtime CUDA via pip (evita ter que
# instalar o CUDA Toolkit inteiro do zero):
.venv\Scripts\pip install nvidia-cublas-cu12 nvidia-cudnn-cu12

cd ..
```

Edite o `.env` (a partir do `.env.example`) e preencha pelo menos:

```ini
TYPESAFE_API_KEY=sua_chave_aqui
WHISPER_PYTHON=python/.venv/Scripts/python.exe
```

Na primeira execução o `faster-whisper` baixa os pesos do modelo
(`large-v3-turbo` por padrão, ~1.5GB) do Hugging Face Hub e guarda em
cache local — só acontece uma vez.

## Rodando

```powershell
npm start
```

Um ícone aparece na bandeja do sistema e uma barrinha de status no topo
da tela. Na primeira vez, espera o overlay sair de "Carregando modelo
de voz" (pode levar ~1min carregando o Whisper na GPU). Depois,
pressione o hotkey (`Ctrl+Space` por padrão) **uma vez** para começar a
ouvir — o worker detecta sozinho quando você parou de falar. Diga algo
como:

> "abrir o bloco de notas"
> "abrir o spotify e depois tocar musica" *(cada clausula vira uma chamada separada ao Jev)*
> "abre o instagram"
> "bloquear a tela"

## Ações suportadas hoje

- `open_app` — abre um programa instalado pelo nome (via `Get-StartApps`)
- `open_url` — abre um site conhecido (Instagram, X, YouTube, Gmail,
  WhatsApp Web, Netflix, TikTok, LinkedIn, GitHub, Reddit, Amazon,
  Mercado Livre, Outlook, Discord, Telegram — ver `src/jev/knownSites.js`)
- `system_action` — `lock`, `sleep`, `mute`, `volume_up`, `volume_down`, `screenshot`

> **Limitação conhecida:** `type_text` e `keystroke` existem no
> `executor.js` mas o Jev (System One) só devolve respostas
> categóricas (sim/não, escolha entre opções, nota numérica) — não gera
> texto livre. Não há hoje de onde tirar "qual texto digitar" ou "qual
> atalho apertar" de forma confiável; essas duas ações praticamente não
> disparam ainda.

Para adicionar apps/sites/ações novas: apps instalados funcionam
automaticamente (lidos do Windows); sites vão em
`src/jev/knownSites.js`; novas ações de sistema entram em
`SYSTEM_ACTIONS` (`src/windows/executor.js`) e na `criteria` de
`system_action` (`src/jev/client.js`).

## Empacotar um instalador (.exe)

```powershell
npm run dist
```

Gera um instalador NSIS em `dist/` via `electron-builder`. Adicione um
ícone `.ico` em `assets/icon.ico` antes de empacotar (o app roda sem
ele, mas o instalador fica sem ícone customizado). O worker Python
**não** é empacotado automaticamente — hoje o app espera achar o venv
em `python/.venv` ao lado do código.

## Estrutura do projeto

```
src/
  main.js                    # processo principal do Electron, orquestra o fluxo
  audio/
    whisperSpeech.js           # wrapper Node do worker Python (fila de pedidos via stdin/stdout)
  jev/
    clauseSplitter.js          # separa frases compostas em clausulas
    client.js                  # cliente HTTP da API do Jev (schema real: model/state/questions)
    knownSites.js               # fallback local pra sites conhecidos (instagram, x, ...)
  windows/
    context.js                  # app + titulo da janela em foco, apps instalados (PowerShell)
    executor.js                  # executa as acoes decididas (PowerShell)
  overlay/
    overlay.html                  # UI da barra de status
    preload.js                     # ponte IPC segura para o overlay
python/
  whisper_worker.py            # processo Python persistente: carrega o modelo 1x, escuta stdin
  requirements.txt              # faster-whisper, sounddevice, numpy
```

## Segurança

- A API key do Jev fica só no `.env` local (não commitar — já está no
  `.gitignore`).
- O áudio é transcrito inteiramente na sua máquina (faster-whisper
  local) — nada de voz sai do seu PC.
- Só a transcrição de texto (clausulas curtas), o app/janela em foco e
  os apps instalados são enviados para a API do Jev.

## Solução de problemas

- **`Library cublas64_12.dll is not found`**: falta o runtime CUDA.
  Rode `python/.venv/Scripts/pip install nvidia-cublas-cu12
  nvidia-cudnn-cu12` (o worker já injeta essas DLLs no PATH sozinho,
  não precisa instalar o CUDA Toolkit completo).
- **Nada é reconhecido / demora muito**: confira se o microfone correto
  está definido como padrão em `Configurações → Sistema → Som →
  Entrada`. Ajuste `SPEECH_INITIAL_SILENCE_SECONDS` /
  `SPEECH_END_SILENCE_SECONDS` no `.env` se estiver cortando cedo
  demais ou demorando demais pra responder.
- **`timeout of XXXXms exceeded` nas chamadas ao Jev**: aumente
  `JEV_TIMEOUT_MS` no `.env` (o payload cresce com o número de apps
  instalados na máquina).
- **Hotkey não funciona**: outro programa pode já estar usando esse
  atalho. Troque `PUSH_TO_TALK_HOTKEY` no `.env` para outra combinação.
- **`open_app`/`open_url` "não encontrei"**: o app precisa aparecer no
  menu Iniciar (`Get-StartApps`) com um nome parecido, ou o site
  precisa estar em `src/jev/knownSites.js`.
