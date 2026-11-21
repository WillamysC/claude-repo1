/** Todo dinheiro no sistema é centavos inteiros. Nunca float para guardar valor. */
export type Centavos = number;

const fmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** 1950 → "R$ 19,50" (com espaço comum, que fica melhor no WhatsApp que o espaço fixo do Intl). */
export function brl(centavos: Centavos): string {
  return fmt.format(centavos / 100).replace(/ /g, " ");
}

/**
 * Lê valor em reais escrito do jeito brasileiro: "10", "10,5", "R$ 1.234,56", "0,85", "3.50".
 * Devolve centavos, ou null se não for um número.
 */
export function lerReais(texto: string): Centavos | null {
  let t = texto.trim().replace(/^r\$\s*/i, "").replace(/\s/g, "");
  if (!t || !/^-?[\d.,]+$/.test(t)) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, ""); // "1.234" = mil duzentos e trinta e quatro
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export function assertCentavos(n: number, nome: string): void {
  if (!Number.isSafeInteger(n)) throw new Error(`${nome} precisa ser um número inteiro de centavos (recebi ${n})`);
}
