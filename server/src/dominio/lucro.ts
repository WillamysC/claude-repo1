import type { Centavos } from "./dinheiro.js";

/**
 * Ponto de equilíbrio (a "fórmula do lucro"):
 *   margem de contribuição = (preço − custo) ÷ preço
 *   ponto de equilíbrio    = custos fixos ÷ margem
 *   unidades para empatar  = ponto de equilíbrio ÷ preço
 * Com vários produtos, a margem é a média ponderada do que foi vendido no período.
 */
export interface ContaPE {
  margem: number; // 0..1 (negativa = preço abaixo do custo)
  pontoEquilibrio: Centavos | null; // null = margem ≤ 0, nunca empata
  unidades: number | null;
}

export function contaPE(preco: Centavos, custo: Centavos, fixos: Centavos): ContaPE {
  const margem = preco > 0 ? (preco - custo) / preco : 0;
  if (margem <= 0) return { margem, pontoEquilibrio: null, unidades: null };
  const pe = fixos / margem;
  return { margem, pontoEquilibrio: Math.round(pe), unidades: Math.ceil(Math.round(pe) / preco) };
}

/** Preço que dá a margem desejada: custo ÷ (1 − margem). */
export function precoParaMargem(custo: Centavos, margemDesejada: number): Centavos | null {
  if (!(margemDesejada > 0 && margemDesejada < 1)) return null;
  return Math.round(custo / (1 - margemDesejada));
}

export interface ItemVendido {
  qtd: number;
  precoCentavos: Centavos;
  custoCentavos?: Centavos | null;
}

export interface ResultadoPeriodo {
  receita: Centavos;
  custoVariavel: Centavos; // inclui estimativa para itens sem custo informado
  margem: number | null; // null = nenhum custo conhecido
  contribuicao: Centavos | null;
  fixos: Centavos;
  resultado: Centavos | null; // contribuição − fixos
  pontoEquilibrio: Centavos | null;
  faltaParaEmpatar: Centavos | null;
  unidades: number;
  precoMedio: Centavos | null;
  unidadesPE: number | null;
  faltaUnidades: number | null;
  receitaSemCusto: Centavos; // vendas de itens sem custo: margem estimada pela média dos outros
}

/**
 * @param margemReserva margem a usar se nenhum item vendido tiver custo (ex.: média do catálogo).
 */
export function resultadoPeriodo(itens: ItemVendido[], fixos: Centavos, margemReserva: number | null = null): ResultadoPeriodo {
  let receita = 0, custo = 0, receitaComCusto = 0, unidades = 0, semCusto = 0;
  for (const i of itens) {
    const v = Math.round(i.qtd * i.precoCentavos);
    receita += v;
    unidades += i.qtd;
    if (i.custoCentavos == null) semCusto += v;
    else {
      custo += Math.round(i.qtd * i.custoCentavos);
      receitaComCusto += v;
    }
  }
  const margem = receitaComCusto > 0 ? (receitaComCusto - custo) / receitaComCusto : margemReserva;
  const contribuicao = margem === null ? null : Math.round(receita * margem);
  const pe = margem !== null && margem > 0 ? Math.round(fixos / margem) : null;
  const precoMedio = unidades > 0 ? Math.round(receita / unidades) : null;
  const falta = pe === null ? null : Math.max(0, pe - receita);
  return {
    receita,
    custoVariavel: contribuicao === null ? custo : receita - contribuicao,
    margem,
    contribuicao,
    fixos,
    resultado: contribuicao === null ? null : contribuicao - fixos,
    pontoEquilibrio: pe,
    faltaParaEmpatar: falta,
    unidades,
    precoMedio,
    unidadesPE: pe !== null && precoMedio ? Math.ceil(pe / precoMedio) : null,
    faltaUnidades: falta !== null && precoMedio ? Math.ceil(falta / precoMedio) : null,
    receitaSemCusto: semCusto,
  };
}
