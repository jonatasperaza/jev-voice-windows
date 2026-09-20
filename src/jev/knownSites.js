'use strict';

/**
 * Fallback local pra sites conhecidos que o usuario pede por nome mas
 * nao sao um app instalado no Windows (ex: "abre o instagram", "vai
 * pro X"). O Jev so devolve respostas categoricas (noul/choice/score),
 * sem tipo de resposta livre — entao nao da pra pedir pra ele "gerar" a
 * URL certa. Isso resolve localmente antes de desistir.
 */

const KNOWN_SITES = {
  instagram: 'https://instagram.com',
  twitter: 'https://x.com',
  x: 'https://x.com',
  facebook: 'https://facebook.com',
  youtube: 'https://youtube.com',
  whatsapp: 'https://web.whatsapp.com',
  gmail: 'https://mail.google.com',
  google: 'https://google.com',
  netflix: 'https://netflix.com',
  tiktok: 'https://tiktok.com',
  linkedin: 'https://linkedin.com',
  github: 'https://github.com',
  reddit: 'https://reddit.com',
  amazon: 'https://amazon.com.br',
  'mercado livre': 'https://mercadolivre.com.br',
  outlook: 'https://outlook.com',
  discord: 'https://discord.com/app',
  telegram: 'https://web.telegram.org',
};

function normalize(str) {
  return String(str)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** Retorna a URL do site conhecido cujo nome aparece na clausula, ou null. */
function matchKnownSite(clause) {
  const normClause = normalize(clause);
  for (const [name, url] of Object.entries(KNOWN_SITES)) {
    if (normClause.includes(normalize(name))) return url;
  }
  return null;
}

module.exports = { matchKnownSite, KNOWN_SITES };
