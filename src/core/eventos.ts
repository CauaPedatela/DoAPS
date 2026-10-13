import { EventEmitter } from 'node:events';

/**
 * Canal de progresso da execução.
 *
 * Existe para a interface web acompanhar o que está acontecendo sem
 * precisar interceptar o console. O terminal continua recebendo tudo:
 * `progresso()` imprime E publica.
 */
const canal = new EventEmitter();
canal.setMaxListeners(20);

export type Evento =
  | { tipo: 'linha'; texto: string }
  | { tipo: 'fase'; texto: string }
  | { tipo: 'fim'; ok: boolean; resumo?: unknown }
  | { tipo: 'erro'; texto: string };

/** Publica uma linha de progresso (e imprime no terminal). */
export function progresso(texto: string, fase = false): void {
  console.log(texto);
  canal.emit('evento', { tipo: fase ? 'fase' : 'linha', texto } satisfies Evento);
}

export function publicar(e: Evento): void {
  if (e.tipo === 'erro') console.error(e.texto);
  canal.emit('evento', e);
}

/** Assina o canal. Devolve a função de cancelamento. */
export function assinar(fn: (e: Evento) => void): () => void {
  canal.on('evento', fn);
  return () => canal.off('evento', fn);
}
