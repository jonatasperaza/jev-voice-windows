'use strict';

/**
 * Cliente da API do Jev (TypeSafe AI "System One", docs.typesafe.ai/api).
 * O Jev nao gera texto livre: so devolve respostas categoricas tipadas
 * (noul = sim/nao, choice = escolher 1 opcao, score = nota numerica),
 * cada uma com "confidence".
 * Body: { model: "jev-latest", state, questions: { <id>: Question } }
 * Resposta: { model, answers: { <id>: Answer }, usage }
 */

const axios = require('axios');

const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const JEV_MODEL = 'jev-latest';

// "choice" so aceita ate 255 opcoes, e Get-StartApps facilmente passa
// disso. Filtra pelos apps cujo nome compartilha alguma palavra com a
// clausula falada (o candidato mais provavel), caindo para os primeiros
// N instalados se nada bater.
const MAX_TARGET_APP_OPTIONS = 80;

function normalizeForMatch(str) {
  return String(str)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function pickRelevantApps(installedApps, clause, limit = MAX_TARGET_APP_OPTIONS) {
  const words = (normalizeForMatch(clause).match(/[a-z0-9]+/g) || []).filter((w) => w.length > 2);
  if (words.length) {
    const matched = installedApps.filter((name) => {
      const normName = normalizeForMatch(name);
      return words.some((w) => normName.includes(w));
    });
    if (matched.length) return matched.slice(0, limit);
  }
  return installedApps.slice(0, limit);
}

function buildQuestions(installedApps, clause) {
  const targetAppCriteria = { none: 'Nenhum app especifico foi mencionado ou e necessario.' };
  for (const name of pickRelevantApps(installedApps, clause)) {
    if (name) targetAppCriteria[name] = `O app instalado chamado "${name}".`;
  }

  return {
    action: {
      type: 'choice',
      instructions: 'Qual tipo de acao o usuario esta pedindo nessa clausula falada?',
      criteria: {
        open_app: 'O usuario quer abrir um aplicativo (ex: "abra o spotify").',
        open_url: 'O usuario quer abrir um site/URL especifico (ex: "abra o google.com", "abre o instagram").',
        system_action: 'O usuario pede uma acao de sistema: bloquear tela, dormir, volume, mute ou print de tela.',
        type_text: 'O usuario quer digitar um texto literal no app em foco.',
        keystroke: 'O usuario quer disparar um atalho de teclado (ex: "salva", "copia", "fecha a janela").',
        unknown: 'Nao da pra saber com confianca o que o usuario quer.',
      },
    },
    target_app: {
      type: 'choice',
      instructions: 'Qual app (dentre os instalados) a clausula se refere, se houver?',
      criteria: targetAppCriteria,
    },
    system_action: {
      type: 'choice',
      instructions: 'Se a acao for "system_action", qual delas especificamente?',
      criteria: {
        lock: 'Bloquear a tela do Windows.',
        sleep: 'Colocar o computador para dormir.',
        volume_up: 'Aumentar o volume.',
        volume_down: 'Diminuir o volume.',
        mute: 'Mutar o audio.',
        screenshot: 'Tirar um print da tela.',
        none: 'Nao e uma acao de sistema.',
      },
    },
    mentions_url: {
      type: 'noul',
      instructions: 'A clausula menciona uma URL ou site especifico (ex: "abra google.com")?',
    },
    refers_to_frontmost: {
      type: 'noul',
      instructions:
        'A clausula se refere a janela/app atualmente em foco, descrito em frontmost_app e frontmost_window_title (ex: "fecha essa janela", "salva isso aqui")?',
    },
  };
}

function normalizeAnswer(answer) {
  if (!answer) return { value: undefined, confidence: 0 };

  switch (answer.type) {
    case 'noul':
      return { value: answer.noul >= 0.5, confidence: Math.abs(answer.noul - 0.5) * 2 };
    case 'choice':
      return { value: answer.choice, confidence: answer.confidence ?? 0 };
    case 'score':
      return { value: answer.score, confidence: answer.confidence ?? 0 };
    default:
      return { value: undefined, confidence: 0 };
  }
}

class JevClient {
  constructor({ apiKey, minConfidence = 0.35, timeoutMs = 4000 } = {}) {
    if (!apiKey) {
      throw new Error(
        'TYPESAFE_API_KEY ausente. Defina no .env (veja .env.example).'
      );
    }
    this.apiKey = apiKey;
    this.minConfidence = minConfidence;
    this.timeoutMs = timeoutMs;
    this.http = axios.create({
      baseURL: JEV_ENDPOINT,
      timeout: timeoutMs,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });
  }

  async decide({ clause, fullTranscript, frontmostApp, frontmostWindowTitle, installedApps = [], questions }) {
    const payload = {
      model: JEV_MODEL,
      state: {
        clause,
        full_transcript: fullTranscript,
        frontmost_app: frontmostApp,
        frontmost_window_title: frontmostWindowTitle,
        installed_apps: installedApps,
      },
      questions: questions || buildQuestions(installedApps, clause),
    };

    const { data } = await this.http.post('', payload);

    const decision = {};
    for (const [id, answer] of Object.entries(data.answers || {})) {
      const normalized = normalizeAnswer(answer);
      if (normalized.value === 'none') normalized.value = null; // "none" e o sentinel de ausencia nas criteria
      decision[id] = normalized;
    }

    // confianca final = minimo entre as perguntas respondidas
    const confidences = Object.values(decision)
      .map((a) => a.confidence)
      .filter((c) => typeof c === 'number');
    const confidence = confidences.length ? Math.min(...confidences) : 0;

    return {
      decision,
      confidence,
      belowThreshold: confidence < this.minConfidence,
      raw: data,
    };
  }
}

module.exports = { JevClient, buildQuestions };
