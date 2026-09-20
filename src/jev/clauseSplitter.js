'use strict';

// Divide "abre o notepad e digita oi" em clausulas separadas, cada uma
// enviada individualmente ao Jev — frase composta de uma vez so reduz a
// confianca da decisao tipada.

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
