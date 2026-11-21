import pg from "pg";
import { criarBanco, migrar } from "../src/db/banco.js";

/**
 * Cria um banco limpo só para os testes. Precisa de um Postgres rodando.
 * TEST_DATABASE_URL aponta para um banco qualquer do servidor, de onde o banco de teste é criado.
 */
const BASE = process.env.TEST_DATABASE_URL ?? "postgres://caderninho:caderninho@localhost:5432/caderninho";
const NOME = "caderninho_teste";

export default async function setup() {
  const admin = new pg.Client({ connectionString: BASE });
  try {
    await admin.connect();
  } catch (e) {
    throw new Error(`Os testes precisam de um Postgres em ${BASE.replace(/:[^:@/]+@/, ":***@")} (defina TEST_DATABASE_URL). ${e}`);
  }
  await admin.query(`drop database if exists ${NOME} with (force)`);
  await admin.query(`create database ${NOME}`);
  await admin.end();

  const url = new URL(BASE);
  url.pathname = `/${NOME}`;
  process.env.DATABASE_URL_TESTE = url.toString();
  const banco = criarBanco(url.toString());
  await migrar(banco);
  await banco.end();
}
