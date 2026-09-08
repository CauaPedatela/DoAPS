import type { APIRequestContext } from 'playwright';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../core/logger.ts';

const DIR = '.media';
/**
 * Lado maior máximo. O custo em tokens de uma imagem é ≈ (l × a) / 750,
 * então 1092×1092 (~1590 tokens) vira 768×768 (~790) — metade, sem perder
 * legibilidade de diagrama ou texto de enunciado.
 */
const MAX_LADO = 768;

export type ImagemPronta = { mimeType: string; data: string };

/** Imagens do filtro TeX do Moodle não são figuras: são texto renderizado. */
export function ehFiltroTex(url: string): boolean {
  return url.includes('/filter/tex/');
}

const chaveDe = (url: string) => createHash('sha256').update(url).digest('hex').slice(0, 24);

/**
 * Baixa, reduz e devolve em base64, com cache em disco.
 *
 * O download usa o contexto autenticado do Playwright: `pluginfile.php`
 * exige a sessão do Moodle, então um fetch anônimo devolveria a página de
 * login em vez do arquivo.
 */
export async function prepararImagem(
  request: APIRequestContext,
  url: string,
): Promise<ImagemPronta | null> {
  if (ehFiltroTex(url)) return null;

  await mkdir(DIR, { recursive: true });
  const cache = join(DIR, `${chaveDe(url)}.jpg`);

  if (existsSync(cache)) {
    return { mimeType: 'image/jpeg', data: (await readFile(cache)).toString('base64') };
  }

  try {
    const resp = await request.get(url, { timeout: 30_000 });
    if (!resp.ok()) {
      logger.warn({ url: url.slice(0, 80), status: resp.status() }, 'imagem não baixou');
      return null;
    }
    const bruto = Buffer.from(await resp.body());

    const reduzida = await sharp(bruto)
      .resize(MAX_LADO, MAX_LADO, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 75 })
      .toBuffer();

    await writeFile(cache, reduzida);
    logger.debug(
      { url: url.slice(0, 60), kbAntes: Math.round(bruto.length / 1024), kbDepois: Math.round(reduzida.length / 1024) },
      'imagem preparada',
    );
    return { mimeType: 'image/jpeg', data: reduzida.toString('base64') };
  } catch (e) {
    logger.warn({ url: url.slice(0, 80), err: String(e).slice(0, 100) }, 'falha ao preparar imagem');
    return null;
  }
}

/** Prepara todas as imagens de um lote, deduplicando por URL. */
export async function prepararLote(
  request: APIRequestContext,
  urls: string[],
): Promise<Map<string, ImagemPronta>> {
  const mapa = new Map<string, ImagemPronta>();
  for (const url of [...new Set(urls)]) {
    const img = await prepararImagem(request, url);
    if (img) mapa.set(url, img);
  }
  return mapa;
}
