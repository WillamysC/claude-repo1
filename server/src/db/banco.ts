import pg from "pg";
import { MIGRACOES } from "./migracoes.js";

// bigint (int8) volta como number. Centavos de um negócio de bairro cabem com folga em 2^53.
pg.types.setTypeParser(20, (v) => Number(v));

export type Banco = pg.Pool;
export type Conexao = pg.Pool | pg.PoolClient;

export function criarBanco(url: string): Banco {
  return new pg.Pool({ connectionString: url, max: 5 });
}

/** Roda `fn` numa transação; desfaz tudo se der erro. */
export async function transacao<T>(banco: Banco, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await banco.connect();
  try {
    await c.query("begin");
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}

export async function migrar(banco: Banco, log: (m: string) => void = () => {}): Promise<void> {
  await transacao(banco, async (c) => {
    // Trava para duas instâncias subindo juntas não rodarem a mesma migração.
    await c.query("select pg_advisory_xact_lock(727274)");
    await c.query("create table if not exists _migracao (nome text primary key, rodada_em timestamptz not null default now())");
    const feitas = new Set((await c.query<{ nome: string }>("select nome from _migracao")).rows.map((r) => r.nome));
    for (const m of MIGRACOES) {
      if (feitas.has(m.nome)) continue;
      await c.query(m.sql);
      await c.query("insert into _migracao (nome) values ($1)", [m.nome]);
      log(`migração aplicada: ${m.nome}`);
    }
  });
}
