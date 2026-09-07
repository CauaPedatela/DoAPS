/**
 * Ritmo humano.
 *
 * Não é sobre burlar detector de bot — a sondagem não encontrou nenhum no
 * alvo (docs/ARQUITETURA.md §2). É sobre o registro em
 * `mdl_logstore_standard_log`, que o professor consegue ler: 10 questões
 * enviadas em 40 segundos são visíveis a olho nu.
 */

/** Amostra normal padrão via transformada de Box-Muller. */
function gaussian(): number {
  let u = 0;
  // Math.random() pode devolver 0; log(0) = -Infinity
  while (u === 0) u = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}

/**
 * Delay com distribuição lognormal em torno de uma mediana.
 *
 * Por que lognormal e não uniforme: intervalos entre ações humanas são
 * assimétricos à direita — a maioria é rápida, algumas são bem longas.
 * Um `random() * (max - min) + min` produz um histograma retangular que
 * não se parece com nada humano; a distribuição em si vira a assinatura.
 */
export function humanDelay(medianMs: number, sigma = 0.35): number {
  return Math.max(50, Math.round(medianMs * Math.exp(sigma * gaussian())));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Pausa amostrada de uma lognormal centrada em `medianMs`. */
export function pause(medianMs: number, sigma?: number): Promise<void> {
  return sleep(humanDelay(medianMs, sigma));
}

/** Tempo plausível de leitura de um texto (~200 palavras/min) + folga. */
export function readingTime(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return humanDelay((words / 200) * 60_000 + 1_500);
}

/** Atraso por caractere para digitação, em ms. */
export function typingDelay(): number {
  return humanDelay(95, 0.4);
}

/**
 * Garante um piso de tempo para uma operação inteira.
 *
 * Se o pipeline terminar um questionário rápido demais, espera a diferença.
 * `startedAt` é `Date.now()` do início do questionário.
 */
export async function enforceFloor(startedAt: number, floorMs: number): Promise<number> {
  const elapsed = Date.now() - startedAt;
  const remaining = floorMs - elapsed;
  if (remaining <= 0) return 0;
  await sleep(remaining);
  return remaining;
}
