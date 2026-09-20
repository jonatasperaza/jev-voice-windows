# Jev Voice Windows

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
