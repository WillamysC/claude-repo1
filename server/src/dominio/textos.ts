/**
 * Textos que o robô manda. São modelos fixos preenchidos pelo servidor:
 * o LLM nunca escreve um número que chega para a vendedora.
 */
import { brl, type Centavos } from "./dinheiro.js";
import type { Aberto, Cliente, ItemCompra, Lancamento } from "./livro.js";
import type { ResultadoPeriodo } from "./lucro.js";

const dataCurta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const qtd = (n: number) => (Number.isInteger(n) ? String(n) : n.toLocaleString("pt-BR"));
const descItens = (itens: ItemCompra[] | null) => (itens ?? []).map((i) => `${qtd(i.qtd)} ${i.nome}`).join(" + ") || "compra";

function linhaSaldo(nome: string, saldo: Centavos): string {
  if (saldo > 0) return `${nome} deve ${brl(saldo)} no total.`;
  if (saldo < 0) return `${nome} ficou com ${brl(-saldo)} de crédito.`;
  return `${nome} não deve nada. ✅`;
}

export function confirmacaoCompra(cliente: Cliente, l: Lancamento, saldo: Centavos): string {
  const total = l.total_centavos ?? l.valor_centavos;
  const situacao =
    l.valor_centavos === 0 ? "pago" : l.pago_na_hora_centavos > 0 ? `pagou ${brl(l.pago_na_hora_centavos)}, ${brl(l.valor_centavos)} no fiado` : "fiado";
  return `✅ ${cliente.nome}: ${descItens(l.itens)}, ${brl(total)}, ${situacao}.\n${linhaSaldo(cliente.nome, saldo)}\n_Errou? Mande "desfaz"._`;
}

export function confirmacaoPagamento(cliente: Cliente, valor: Centavos, saldo: Centavos): string {
  return `✅ ${cliente.nome} pagou ${brl(valor)}.\n${linhaSaldo(cliente.nome, saldo)}\n_Errou? Mande "desfaz"._`;
}

export function confirmacaoEstorno(cliente: Cliente, l: Lancamento, saldo: Centavos): string {
  const o_que = l.tipo === "pagamento" ? `pagamento de ${brl(-l.valor_centavos)}` : `${descItens(l.itens)} (${brl(l.total_centavos ?? l.valor_centavos)})`;
  return `↩️ Desfeito: ${o_que} de ${cliente.nome}.\n${linhaSaldo(cliente.nome, saldo)}`;
}

export function mensagemCobranca(opts: { cliente: Cliente; negocio: string; abertos: Aberto[]; saldo: Centavos; pix?: string }): string {
  const primeiro = opts.cliente.nome.split(/\s+/)[0];
  const linhas = opts.abertos.map((a) => `• ${dataCurta(a.lancamento.ocorreu_em)}: ${descItens(a.lancamento.itens)} (${brl(a.restaCentavos)})`).join("\n");
  return [
    `Oi, ${primeiro}! Tudo bem? 😊`,
    `Passando pra lembrar do que ficou anotado aqui no ${opts.negocio}:`,
    linhas,
    `Total em aberto: *${brl(opts.saldo)}*`,
    opts.pix ? `\nPix copia e cola (já com o valor):\n${opts.pix}` : "",
    `\nQualquer coisa me chama. Obrigado(a)!`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function resumoMes(r: ResultadoPeriodo, opts: { mes: string; diaHoje: number; diasRestantes: number; unidade: string; noFiado: Centavos }): string {
  if (r.margem === null || r.fixos === 0)
    return `📊 ${opts.mes}: vendido ${brl(r.receita)}.\nPra eu calcular seu lucro, me diga o custo dos produtos ("o dudu de morango sai 85 centavos") e as contas fixas do mês ("luz do freezer 90").`;
  const pct = `${Math.round(r.margem * 100)}%`;
  const cab = `📊 ${opts.mes} até hoje (dia ${opts.diaHoje})\nVendido: ${brl(r.receita)} · margem de ${pct}\nContas fixas: ${brl(r.fixos)}`;
  if (r.pontoEquilibrio === null) return `${cab}\n⚠️ Sua margem está zerada ou negativa: o preço não cobre o custo.`;
  const pe = `Ponto de equilíbrio: ${brl(r.pontoEquilibrio)}${r.unidadesPE ? ` (≈ ${r.unidadesPE} ${opts.unidade} no mês)` : ""}`;
  const meio =
    r.faltaParaEmpatar && r.faltaParaEmpatar > 0
      ? `Faltam ${brl(r.faltaParaEmpatar)} pra empatar${r.faltaUnidades ? ` (≈ ${r.faltaUnidades} ${opts.unidade} em ${opts.diasRestantes} dias, uns ${Math.ceil(r.faltaUnidades / Math.max(1, opts.diasRestantes))} por dia)` : ""}.`
      : `Você já passou do empate: lucro estimado de ${brl(r.resultado ?? 0)}. 🎉`;
  const fiado = opts.noFiado > 0 ? `\n⚠️ ${brl(opts.noFiado)} estão no fiado. "cobra a <nome>" ajuda a fechar o mês.` : "";
  return `${cab}\n${pe}\n\n${meio}${fiado}`;
}
