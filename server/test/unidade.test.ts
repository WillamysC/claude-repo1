import { describe, expect, it } from "vitest";
import { brl, lerReais } from "../src/dominio/dinheiro.js";
import { abrirFIFO, type Lancamento } from "../src/dominio/livro.js";
import { contaPE, precoParaMargem, resultadoPeriodo } from "../src/dominio/lucro.js";
import { crc16, pixCopiaECola } from "../src/dominio/pix.js";
import { assinar, assinaturaValida } from "../src/whatsapp/assinatura.js";
import { extrairMensagens, numeroPermitido, variantesNumeroBR } from "../src/whatsapp/webhook.js";

describe("dinheiro", () => {
  it("formata em reais", () => {
    expect(brl(1950)).toBe("R$ 19,50");
    expect(brl(159681)).toBe("R$ 1.596,81");
  });
  it("lê valores do jeito brasileiro", () => {
    expect(lerReais("10")).toBe(1000);
    expect(lerReais("0,85")).toBe(85);
    expect(lerReais("R$ 1.234,56")).toBe(123456);
    expect(lerReais("1.234")).toBe(123400);
    expect(lerReais("3.50")).toBe(350);
    expect(lerReais("dez")).toBeNull();
  });
});

describe("ponto de equilíbrio (exemplo do vídeo)", () => {
  it("compro a R$ 2,99, vendo a R$ 8, fixos de R$ 1.000", () => {
    const c = contaPE(800, 299, 100000);
    expect(c.margem).toBeCloseTo(0.62625, 5); // tela mostra 63%
    expect(c.pontoEquilibrio).toBe(159681); // R$ 1.596,81
    expect(c.unidades).toBe(200);
  });
  it("preço abaixo do custo nunca empata", () => {
    expect(contaPE(200, 250, 10000)).toEqual({ margem: -0.25, pontoEquilibrio: null, unidades: null });
  });
  it("preço para margem desejada", () => {
    expect(precoParaMargem(299, 0.6)).toBe(748);
    expect(precoParaMargem(299, 1)).toBeNull();
  });
  it("mês com vários produtos usa a margem ponderada do que foi vendido", () => {
    const r = resultadoPeriodo(
      [
        { qtd: 10, precoCentavos: 300, custoCentavos: 110 }, // 3000 receita, 1100 custo
        { qtd: 4, precoCentavos: 250, custoCentavos: 85 }, // 1000 receita, 340 custo
      ],
      20000,
    );
    expect(r.receita).toBe(4000);
    expect(r.margem).toBeCloseTo((4000 - 1440) / 4000, 6);
    expect(r.contribuicao).toBe(2560);
    expect(r.resultado).toBe(2560 - 20000);
    expect(r.pontoEquilibrio).toBe(31250);
    expect(r.faltaParaEmpatar).toBe(27250);
    expect(r.unidadesPE).toBe(Math.ceil(31250 / Math.round(4000 / 14)));
  });
  it("item sem custo usa a margem dos outros e é sinalizado", () => {
    const r = resultadoPeriodo([{ qtd: 1, precoCentavos: 1000, custoCentavos: 400 }, { qtd: 1, precoCentavos: 1000 }], 0);
    expect(r.margem).toBeCloseTo(0.6);
    expect(r.receitaSemCusto).toBe(1000);
    expect(r.custoVariavel).toBe(800);
  });
});

describe("Pix copia e cola", () => {
  it("CRC16-CCITT bate com o valor de referência", () => {
    expect(crc16("123456789")).toBe("29B1");
  });
  it("reproduz o exemplo do manual do BR Code", () => {
    const p = pixCopiaECola({ chave: "123e4567-e12b-12d1-a456-426655440000", nome: "Fulano de Tal", cidade: "BRASILIA" });
    expect(p).toBe("00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D");
  });
  it("inclui valor, tira acentos e limita tamanhos", () => {
    const p = pixCopiaECola({ chave: "dudus@exemplo.com", nome: "Dudus da Vila Conceição Ltda Ponto Com", cidade: "São Lourenço da Mata", valorCentavos: 1950, txid: "ana-19" });
    expect(p).toContain("540519.50");
    expect(p).toContain("5925Dudus da Vila Conceicao ");
    expect(p).toContain("6015Sao Lourenco da");
    expect(p).toContain("0505ana19");
    expect(p.slice(-4)).toBe(crc16(p.slice(0, -4)));
  });
});

describe("FIFO do fiado", () => {
  const l = (valor: number, data: string, tipo: Lancamento["tipo"] = "compra"): Lancamento => ({
    id: data + valor, negocio_id: "n", cliente_id: "c", tipo, valor_centavos: valor, total_centavos: valor,
    pago_na_hora_centavos: 0, itens: null, forma: null, ocorreu_em: data, estorna_id: null, criado_em: new Date(data),
  });
  it("abate o pagamento das compras mais antigas primeiro", () => {
    const a = abrirFIFO([l(2800, "2026-11-05"), l(2200, "2026-11-12"), l(-3050, "2026-11-15", "pagamento")]);
    expect(a.map((x) => [x.lancamento.ocorreu_em, x.restaCentavos])).toEqual([["2026-11-12", 1950]]);
  });
});

describe("webhook", () => {
  const segredo = "s3gr3d0";
  it("valida a assinatura HMAC do corpo bruto", () => {
    const corpo = '{"a":1}';
    expect(assinaturaValida(corpo, assinar(corpo, segredo), segredo)).toBe(true);
    expect(assinaturaValida(corpo + " ", assinar(corpo, segredo), segredo)).toBe(false);
    expect(assinaturaValida(corpo, "sha256=00", segredo)).toBe(false);
    expect(assinaturaValida(corpo, undefined, segredo)).toBe(false);
  });

  const payload = (phoneId: string, mensagens: object[]) => ({
    object: "whatsapp_business_account",
    entry: [{ id: "1", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: phoneId, display_phone_number: "15550000000" }, contacts: [{ wa_id: "558199991234", profile: { name: "Dani" } }], messages: mensagens } }] }],
  });

  it("extrai texto, áudio e botão; ignora outro número e status", () => {
    const ms = extrairMensagens(
      payload("PNID", [
        { from: "558199991234", id: "wamid.1", timestamp: "1763740000", type: "text", text: { body: "Ana levou 3" } },
        { from: "558199991234", id: "wamid.2", timestamp: "1763740001", type: "audio", audio: { id: "MID", mime_type: "audio/ogg", voice: true } },
        { from: "558199991234", id: "wamid.3", timestamp: "1763740002", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "op1", title: "Ana Paula" } } },
        { from: "558199991234", id: "wamid.4", timestamp: "1763740003", type: "sticker", sticker: { id: "x" } },
      ]),
      "PNID",
    );
    expect(ms.map((m) => [m.tipo, m.conteudo ?? m.midiaId])).toEqual([["texto", "Ana levou 3"], ["audio", "MID"], ["botao", "op1"], ["outro", undefined]]);
    expect(ms[0]!.nomePerfil).toBe("Dani");
    expect(ms[0]!.recebidaEm.getTime()).toBe(1763740000 * 1000);
    expect(extrairMensagens(payload("OUTRO", [{ from: "1", id: "x", timestamp: "1", type: "text", text: { body: "oi" } }]), "PNID")).toEqual([]);
    expect(extrairMensagens({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { statuses: [{}] } }] }] }, "PNID")).toEqual([]);
    expect(extrairMensagens({ lixo: true }, "PNID")).toEqual([]);
  });

  it("reconhece o número com e sem o nono dígito", () => {
    expect(variantesNumeroBR("5581999991234")).toEqual(["5581999991234", "558199991234"]);
    expect(variantesNumeroBR("558199991234")).toEqual(["558199991234", "5581999991234"]);
    expect(numeroPermitido("558199991234", new Set(["5581999991234"]))).toBe(true);
    expect(numeroPermitido("558133334444", new Set(["5581999991234"]))).toBe(false);
  });
});
