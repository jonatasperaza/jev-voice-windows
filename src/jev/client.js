'use strict';

/**
 * Cliente para a API do Jev (TypeSafe AI - "System One").
 *
 * O Jev nao gera texto livre: recebe um payload de estado (a clausula
 * falada, o transcript completo, o app em foco, os apps instalados) mais
 * um dicionario de perguntas tipadas (noul = sim/nao, choice = escolher
 * 1 opcao, score = nota numa escala), e devolve uma resposta calibrada
 * com "confidence" por pergunta. Isso espelha o que os projetos
 * jev-voice-control / jev-voice fazem no Mac.
 *
 * Schema real da API (https://docs.typesafe.ai/api), body:
 *   { model: "jev-latest", state: ..., questions: { <id>: Question } }
 * Question = { type: "noul"|"choice"|"score", instructions, criteria }
 * Resposta: { model, answers: { <id>: Answer }, usage }
 *
 * Endpoint: POST https://api.typesafe.ai/v1/systemone
 * Auth: header Authorization: Bearer <TYPESAFE_API_KEY>
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

// Monta o dicionario de perguntas por chamada, porque "target_app"
// precisa listar os apps instalados como opcoes (criteria) dinamicamente.
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

// Converte uma Answer da API (noul/choice/score) no formato interno
// {value, confidence} usado pelo executor.
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

  /**
   * Envia uma clausula para o Jev decidir o que fazer.
   *
   * @param {object} params
   * @param {string} params.clause - a clausula falada (ja separada pelo clauseSplitter)
   * @param {string} params.fullTranscript - transcript completo original
   * @param {string} params.frontmostApp - nome do app em foco no Windows
   * @param {string} [params.frontmostWindowTitle] - titulo da janela em foco (ex: titulo da aba ativa no Chrome)
   * @param {string[]} params.installedApps - lista de apps instalados/conhecidos
   * @param {object} [params.questions] - sobrescreve o dicionario de perguntas padrao
   * @returns {Promise<{decision: object, confidence: number, belowThreshold: boolean, raw: object}>}
   */
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

    // Normaliza cada resposta (noul/choice/score) para {value, confidence}
    // e usa o "none" sentinel de target_app/system_action como ausencia.
    const decision = {};
    for (const [id, answer] of Object.entries(data.answers || {})) {
      const normalized = normalizeAnswer(answer);
      if (normalized.value === 'none') normalized.value = null;
      decision[id] = normalized;
    }

    // Confianca da decisao = minimo entre as perguntas respondidas
    // (mesma regra do jev-voice: "plan confidence is the minimum over
    // the judgements used").
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
