import type { Centavos } from "./dinheiro.js";

/**
 * Pix "copia e cola" estático (BR Code, padrão EMV do Banco Central), gerado sem banco nem intermediário.
 * Campos: 00 formato · 26 conta (GUI + chave) · 52 categoria · 53 moeda (986 = BRL) · 54 valor
 *         58 país · 59 nome · 60 cidade · 62 dados adicionais (05 = txid) · 63 CRC16.
 */
export interface DadosPix {
  chave: string;
  nome: string;
  cidade: string;
  valorCentavos?: Centavos;
  /** Identificador que aparece no extrato de quem recebe. Até 25 letras/números. */
  txid?: string;
}

const campo = (id: string, valor: string): string => {
  if (valor.length > 99) throw new Error(`Campo ${id} do Pix passou de 99 caracteres`);
  return id + String(valor.length).padStart(2, "0") + valor;
};

/** Tira acentos e caracteres fora do padrão; o BR Code aceita só ASCII. */
const limpar = (s: string, max: number): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 .\-@]/g, "")
    .trim()
    .slice(0, max);

/** CRC16-CCITT (polinômio 0x1021, início 0xFFFF), em 4 dígitos hexadecimais maiúsculos. */
export function crc16(texto: string): string {
  let crc = 0xffff;
  for (const byte of Buffer.from(texto, "utf8")) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export function pixCopiaECola(d: DadosPix): string {
  const chave = d.chave.trim();
  if (!chave) throw new Error("Chave Pix vazia");
  const nome = limpar(d.nome, 25) || "RECEBEDOR";
  const cidade = limpar(d.cidade, 15) || "BRASIL";
  const txid = (d.txid ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 25) || "***";
  let p =
    campo("00", "01") +
    campo("26", campo("00", "br.gov.bcb.pix") + campo("01", chave)) +
    campo("52", "0000") +
    campo("53", "986");
  if (d.valorCentavos !== undefined && d.valorCentavos > 0) p += campo("54", (d.valorCentavos / 100).toFixed(2));
  p += campo("58", "BR") + campo("59", nome) + campo("60", cidade) + campo("62", campo("05", txid)) + "6304";
  return p + crc16(p);
}
