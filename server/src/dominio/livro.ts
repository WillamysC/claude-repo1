import type { Conexao } from "../db/banco.js";
import { assertCentavos, type Centavos } from "./dinheiro.js";

/**
 * Livro-razão do fiado. Só acrescenta lançamentos; correção é estorno.
 * Convenção: valor_centavos é o efeito no saldo (+ aumenta a dívida, − diminui).
 * Uma compra é sempre registrada, mesmo paga na hora, porque ela conta no faturamento e no lucro.
 */

export interface Negocio {
  id: string;
  wa_id_dono: string;
  nome: string | null;
  pix_chave: string | null;
  pix_nome: string | null;
  pix_cidade: string | null;
  fuso: string;
  meta_lucro_centavos: number | null;
}

export interface Cliente {
  id: string;
  negocio_id: string;
  nome: string;
  apelidos: string[];
  telefone: string | null;
  limite_centavos: number | null;
}

export interface ItemCompra {
  produtoId?: string;
  nome: string;
  qtd: number;
  precoCentavos: Centavos;
  custoCentavos?: Centavos | null;
}

export type Forma = "pix" | "dinheiro" | "cartao";

export interface Lancamento {
  id: string;
  negocio_id: string;
  cliente_id: string;
  tipo: "compra" | "pagamento" | "estorno" | "ajuste";
  valor_centavos: number;
  total_centavos: number | null;
  pago_na_hora_centavos: number;
  itens: ItemCompra[] | null;
  forma: Forma | null;
  ocorreu_em: string; // YYYY-MM-DD
  estorna_id: string | null;
  criado_em: Date;
}

const COLS = "id, negocio_id, cliente_id, tipo, valor_centavos, total_centavos, pago_na_hora_centavos, itens, forma, to_char(ocorreu_em, 'YYYY-MM-DD') as ocorreu_em, estorna_id, criado_em";

/** Encontra o negócio pelo número de quem conversa, criando se for a primeira vez. */
export async function garantirNegocio(c: Conexao, waId: string): Promise<{ negocio: Negocio; novo: boolean }> {
  const ins = await c.query<Negocio>(
    "insert into negocio (wa_id_dono) values ($1) on conflict (wa_id_dono) do nothing returning *",
    [waId],
  );
  if (ins.rows[0]) return { negocio: ins.rows[0], novo: true };
  const r = await c.query<Negocio>("select * from negocio where wa_id_dono = $1", [waId]);
  return { negocio: r.rows[0]!, novo: false };
}

export async function criarCliente(c: Conexao, negocioId: string, nome: string, extra: { apelidos?: string[]; telefone?: string } = {}): Promise<Cliente> {
  const n = nome.trim();
  if (!n) throw new Error("Nome do cliente vazio");
  const r = await c.query<Cliente>(
    "insert into cliente (negocio_id, nome, apelidos, telefone) values ($1, $2, $3, $4) returning id, negocio_id, nome, apelidos, telefone, limite_centavos",
    [negocioId, n, extra.apelidos ?? [], extra.telefone ?? null],
  );
  return r.rows[0]!;
}

export interface NovaCompra {
  negocioId: string;
  clienteId: string;
  itens: ItemCompra[];
  /** Quando ela fala o valor ("3 dudu por 5 reais"), vale o informado em vez da soma dos itens. */
  totalInformadoCentavos?: Centavos;
  pagoNaHoraCentavos?: Centavos;
  forma?: Forma;
  ocorreuEm: string;
  mensagemId?: string;
}

export async function registrarCompra(c: Conexao, n: NovaCompra): Promise<{ lancamento: Lancamento; saldo: Centavos }> {
  if (!n.itens.length && n.totalInformadoCentavos === undefined) throw new Error("Compra sem itens e sem valor");
  for (const i of n.itens) {
    if (!(i.qtd > 0)) throw new Error(`Quantidade inválida para ${i.nome}`);
    assertCentavos(i.precoCentavos, "preço");
    if (i.custoCentavos != null) assertCentavos(i.custoCentavos, "custo");
  }
  const soma = n.itens.reduce((s, i) => s + Math.round(i.qtd * i.precoCentavos), 0);
  const total = n.totalInformadoCentavos ?? soma;
  const pago = n.pagoNaHoraCentavos ?? 0;
  assertCentavos(total, "total");
  assertCentavos(pago, "pago na hora");
  if (total <= 0) throw new Error("Compra com valor zero");
  if (pago < 0 || pago > total) throw new Error("Valor pago na hora maior que a compra");
  const r = await c.query<Lancamento>(
    `insert into lancamento (negocio_id, cliente_id, tipo, valor_centavos, total_centavos, pago_na_hora_centavos, itens, forma, ocorreu_em, mensagem_id)
     values ($1, $2, 'compra', $3, $4, $5, $6, $7, $8, $9) returning ${COLS}`,
    [n.negocioId, n.clienteId, total - pago, total, pago, JSON.stringify(n.itens), pago > 0 ? n.forma ?? null : null, n.ocorreuEm, n.mensagemId ?? null],
  );
  return { lancamento: r.rows[0]!, saldo: await saldo(c, n.clienteId) };
}

export async function registrarPagamento(
  c: Conexao,
  n: { negocioId: string; clienteId: string; valorCentavos: Centavos; forma?: Forma; ocorreuEm: string; mensagemId?: string },
): Promise<{ lancamento: Lancamento; saldo: Centavos }> {
  assertCentavos(n.valorCentavos, "valor");
  if (n.valorCentavos <= 0) throw new Error("Pagamento precisa ser maior que zero");
  const r = await c.query<Lancamento>(
    `insert into lancamento (negocio_id, cliente_id, tipo, valor_centavos, forma, ocorreu_em, mensagem_id)
     values ($1, $2, 'pagamento', $3, $4, $5, $6) returning ${COLS}`,
    [n.negocioId, n.clienteId, -n.valorCentavos, n.forma ?? null, n.ocorreuEm, n.mensagemId ?? null],
  );
  return { lancamento: r.rows[0]!, saldo: await saldo(c, n.clienteId) };
}

/** Desfaz o último lançamento do negócio (feito nas últimas `janelaHoras`), criando um estorno. */
export async function estornarUltimo(
  c: Conexao,
  negocioId: string,
  opts: { janelaHoras?: number; mensagemId?: string } = {},
): Promise<{ estornado: Lancamento; saldo: Centavos } | null> {
  const r = await c.query<Lancamento>(
    `select ${COLS} from lancamento l
      where negocio_id = $1 and tipo <> 'estorno'
        and not exists (select 1 from lancamento e where e.estorna_id = l.id)
        and criado_em > now() - make_interval(hours => $2)
      order by criado_em desc limit 1
      for update`,
    [negocioId, opts.janelaHoras ?? 24],
  );
  const alvo = r.rows[0];
  if (!alvo) return null;
  await c.query(
    `insert into lancamento (negocio_id, cliente_id, tipo, valor_centavos, ocorreu_em, estorna_id, mensagem_id)
     values ($1, $2, 'estorno', $3, current_date, $4, $5)`,
    [negocioId, alvo.cliente_id, -alvo.valor_centavos, alvo.id, opts.mensagemId ?? null],
  );
  return { estornado: alvo, saldo: await saldo(c, alvo.cliente_id) };
}

export async function saldo(c: Conexao, clienteId: string): Promise<Centavos> {
  const r = await c.query<{ s: number }>("select coalesce(sum(valor_centavos), 0)::bigint as s from lancamento where cliente_id = $1", [clienteId]);
  return r.rows[0]!.s;
}

/** Lançamentos válidos (sem os estornados e sem os próprios estornos), do mais antigo ao mais novo. */
export async function lancamentosValidos(c: Conexao, clienteId: string): Promise<Lancamento[]> {
  const r = await c.query<Lancamento>(
    `select ${COLS} from lancamento l
      where cliente_id = $1 and tipo <> 'estorno'
        and not exists (select 1 from lancamento e where e.estorna_id = l.id)
      order by ocorreu_em, criado_em`,
    [clienteId],
  );
  return r.rows;
}

export interface Aberto {
  lancamento: Lancamento;
  restaCentavos: Centavos;
}

/** O que está em aberto, abatendo os pagamentos das compras mais antigas primeiro (como no caderno). */
export function abrirFIFO(lancs: Lancamento[]): Aberto[] {
  let credito = lancs.filter((l) => l.valor_centavos < 0).reduce((s, l) => s - l.valor_centavos, 0);
  const abertos: Aberto[] = [];
  for (const l of lancs) {
    if (l.valor_centavos <= 0) continue;
    if (credito >= l.valor_centavos) {
      credito -= l.valor_centavos;
      continue;
    }
    abertos.push({ lancamento: l, restaCentavos: l.valor_centavos - credito });
    credito = 0;
  }
  return abertos;
}

export async function emAberto(c: Conexao, clienteId: string): Promise<Aberto[]> {
  return abrirFIFO(await lancamentosValidos(c, clienteId));
}

export async function devedores(c: Conexao, negocioId: string): Promise<{ cliente: Cliente; saldo: Centavos }[]> {
  const r = await c.query<Cliente & { saldo: number }>(
    `select c.id, c.negocio_id, c.nome, c.apelidos, c.telefone, c.limite_centavos, s.saldo_centavos as saldo
       from cliente c join saldo_cliente s on s.cliente_id = c.id
      where c.negocio_id = $1 and s.saldo_centavos > 0
      order by s.saldo_centavos desc`,
    [negocioId],
  );
  return r.rows.map(({ saldo: s, ...cliente }) => ({ cliente, saldo: s }));
}

/** Itens vendidos no período (compras não estornadas), para a conta do lucro. */
export async function itensVendidos(c: Conexao, negocioId: string, de: string, ate: string): Promise<ItemCompra[]> {
  const r = await c.query<{ itens: ItemCompra[] | null; total_centavos: number }>(
    `select itens, total_centavos from lancamento l
      where negocio_id = $1 and tipo = 'compra' and ocorreu_em between $2 and $3
        and not exists (select 1 from lancamento e where e.estorna_id = l.id)`,
    [negocioId, de, ate],
  );
  return r.rows.flatMap((row) => {
    const itens = row.itens ?? [];
    const soma = itens.reduce((s, i) => s + Math.round(i.qtd * i.precoCentavos), 0);
    // Valor combinado diferente da soma ("3 por 5 reais"): ajusta o preço proporcionalmente.
    if (!itens.length) return [{ nome: "Venda", qtd: 1, precoCentavos: row.total_centavos, custoCentavos: null }];
    if (soma === row.total_centavos || soma === 0) return itens;
    const f = row.total_centavos / soma;
    return itens.map((i) => ({ ...i, precoCentavos: Math.round(i.precoCentavos * f) }));
  });
}
