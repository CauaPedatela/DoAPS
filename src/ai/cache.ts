import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Resposta } from './types.ts';

/**
 * Cache de respostas por hash de conteúdo.
 *
 * A mesma questão reaparece entre tentativas da mesma APS e entre
 * semestres. Um acerto aqui custa zero token e zero latência.
 * node:sqlite é builtin do Node 24 — sem dependência.
 */
export class CacheRespostas {
  readonly #db: DatabaseSync;

  constructor(caminho = 'cache/respostas.db') {
    mkdirSync(dirname(caminho), { recursive: true });
    this.#db = new DatabaseSync(caminho);
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS respostas (
        hash    TEXT PRIMARY KEY,
        modelo  TEXT NOT NULL,
        valor   TEXT NOT NULL,
        conf    TEXT NOT NULL,
        criado  INTEGER NOT NULL
      )
    `);
  }

  buscar(hash: string, modelo: string): Resposta | null {
    const linha = this.#db
      .prepare('SELECT valor, conf FROM respostas WHERE hash = ? AND modelo = ?')
      .get(hash, modelo) as { valor: string; conf: string } | undefined;
    if (!linha) return null;
    return { n: -1, a: linha.valor, conf: linha.conf as Resposta['conf'] };
  }

  gravar(hash: string, modelo: string, r: Resposta): void {
    this.#db
      .prepare(
        'INSERT OR REPLACE INTO respostas (hash, modelo, valor, conf, criado) VALUES (?,?,?,?,?)',
      )
      .run(hash, modelo, r.a, r.conf, Date.now());
  }

  fechar(): void {
    this.#db.close();
  }
}
