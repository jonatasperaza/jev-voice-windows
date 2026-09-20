'use strict';

/**
 * Divide uma transcricao com multiplos verbos em clausulas separadas,
 * cada uma enviada individualmente ao Jev (mesma ideia do jev-voice-control
 * no Mac: "open notes and create a new note" -> ["open notes", "create a new note"]).
 *
 * E uma heuristica simples baseada em conectores comuns em portugues e
 * ingles. O Jev decide a acao real; isso so evita mandar uma frase composta
 * de uma vez so, o que reduz a confianca da decisao tipada.
 */

const CONNECTORS = [
  ' e depois ',
  ' e ',
  ' depois ',
  ' then ',
  ' and then ',
  ' and ',
];

function splitClauses(transcript) {
  if (!transcript || !transcript.trim()) return [];

  let working = ` ${transcript.trim()} `;
  let parts = [working];

  for (const connector of CONNECTORS) {
    const next = [];
    for (const part of parts) {
      next.push(...part.split(connector));
    }
    parts = next;
  }

  return parts
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

module.exports = { splitClauses };
