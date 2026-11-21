import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { criarApp } from "../src/app.js";
import { criarBanco, migrar, transacao } from "../src/db/banco.js";
import {
  criarCliente, devedores, emAberto, estornarUltimo, garantirNegocio, itensVendidos, registrarCompra, registrarPagamento, saldo,
} from "../src/dominio/livro.js";
import { resultadoPeriodo } from "../src/dominio/lucro.js";
import { confirmacaoCompra, mensagemCobranca } from "../src/dominio/textos.js";
import { Trabalhador } from "../src/fila.js";
import { criarProcessador, TEXTO_BOAS_VINDAS } from "../src/processar.js";
import { assinar } from "../src/whatsapp/assinatura.js";
import { ErroWhatsApp, type Mensageiro } from "../src/whatsapp/mensageiro.js";

const URL_TESTE = process.env.DATABASE_URL_TESTE ?? "postgres://caderninho:caderninho@localhost:5432/caderninho_teste";
const banco = criarBanco(URL_TESTE);
afterAll(() => banco.end());

beforeEach(async () => {
  await banco.query("truncate negocio, mensagem cascade");
});

const HOJE = "2026-11-21";

describe("livro-razão", () => {
  it("compra no fiado, parte paga, pagamento e saldo", async () => {
    const { negocio } = await garantirNegocio(banco, "5581999990000");
    const ana = await criarCliente(banco, negocio.id, "Ana Paula");
    const c1 = await registrarCompra(banco, {
      negocioId: negocio.id, clienteId: ana.id, ocorreuEm: "2026-11-05",
      itens: [{ nome: "dudu de ninho", qtd: 6, precoCentavos: 300, custoCentavos: 110 }, { nome: "dudu de morango", qtd: 4, precoCentavos: 250, custoCentavos: 85 }],
    });
    expect(c1.lancamento.valor_centavos).toBe(2800);
    expect(c1.saldo).toBe(2800);
    const c2 = await registrarCompra(banco, {
      negocioId: negocio.id, clienteId: ana.id, ocorreuEm: "2026-11-12", itens: [{ nome: "pacote 10 dudus", qtd: 1, precoCentavos: 2200 }], pagoNaHoraCentavos: 500, forma: "pix",
    });
    expect(c2.lancamento.valor_centavos).toBe(1700);
    expect(c2.lancamento.total_centavos).toBe(2200);
    const p = await registrarPagamento(banco, { negocioId: negocio.id, clienteId: ana.id, valorCentavos: 3000, forma: "pix", ocorreuEm: "2026-11-15" });
    expect(p.saldo).toBe(1500);

    const ab = await emAberto(banco, ana.id);
    expect(ab.map((a) => [a.lancamento.ocorreu_em, a.restaCentavos])).toEqual([["2026-11-12", 1500]]);
    expect((await devedores(banco, negocio.id)).map((d) => [d.cliente.nome, d.saldo])).toEqual([["Ana Paula", 1500]]);

    expect(confirmacaoCompra(ana, c2.lancamento, c2.saldo)).toBe(
      '✅ Ana Paula: 1 pacote 10 dudus, R$ 22,00, pagou R$ 5,00, R$ 17,00 no fiado.\nAna Paula deve R$ 45,00 no total.\n_Errou? Mande "desfaz"._',
    );
    const cob = mensagemCobranca({ cliente: ana, negocio: "Dudus da Vila", abertos: ab, saldo: 1500, pix: "000201...6304ABCD" });
    expect(cob).toContain("• 12/11: 1 pacote 10 dudus (R$ 15,00)");
    expect(cob).toContain("Total em aberto: *R$ 15,00*");
  });

  it("desfaz o último lançamento com estorno, sem apagar nada", async () => {
    const { negocio } = await garantirNegocio(banco, "5581999990000");
    const bia = await criarCliente(banco, negocio.id, "Bia");
    await registrarCompra(banco, { negocioId: negocio.id, clienteId: bia.id, ocorreuEm: HOJE, itens: [{ nome: "dudu", qtd: 2, precoCentavos: 250 }] });
    await registrarPagamento(banco, { negocioId: negocio.id, clienteId: bia.id, valorCentavos: 500, ocorreuEm: HOJE });
    expect(await saldo(banco, bia.id)).toBe(0);

    const e = await estornarUltimo(banco, negocio.id);
    expect(e?.estornado.tipo).toBe("pagamento");
    expect(e?.saldo).toBe(500);
    const e2 = await estornarUltimo(banco, negocio.id);
    expect(e2?.estornado.tipo).toBe("compra");
    expect(e2?.saldo).toBe(0);
    expect(await estornarUltimo(banco, negocio.id)).toBeNull();

    const n = await banco.query("select count(*)::int as n from lancamento where negocio_id = $1", [negocio.id]);
    expect(n.rows[0].n).toBe(4); // 2 originais + 2 estornos
    expect(await itensVendidos(banco, negocio.id, "2026-11-01", "2026-11-30")).toEqual([]); // compra estornada não conta no lucro
  });

  it("o banco recusa editar ou apagar lançamento", async () => {
    const { negocio } = await garantirNegocio(banco, "5581999990000");
    const c = await criarCliente(banco, negocio.id, "Carla");
    const { lancamento } = await registrarCompra(banco, { negocioId: negocio.id, clienteId: c.id, ocorreuEm: HOJE, itens: [{ nome: "dudu", qtd: 1, precoCentavos: 250 }] });
    await expect(banco.query("update lancamento set valor_centavos = 0 where id = $1", [lancamento.id])).rejects.toThrow(/só de acréscimo/);
    await expect(banco.query("delete from lancamento where id = $1", [lancamento.id])).rejects.toThrow(/só de acréscimo/);
    // Excluir a conta inteira (LGPD) continua possível, em cascata.
    await banco.query("delete from negocio where id = $1", [negocio.id]);
    expect((await banco.query("select count(*)::int as n from lancamento")).rows[0].n).toBe(0);
  });

  it("recusa valores inválidos", async () => {
    const { negocio } = await garantirNegocio(banco, "5581999990000");
    const c = await criarCliente(banco, negocio.id, "Rafa");
    const base = { negocioId: negocio.id, clienteId: c.id, ocorreuEm: HOJE };
    await expect(registrarCompra(banco, { ...base, itens: [{ nome: "dudu", qtd: 1, precoCentavos: 2.5 }] })).rejects.toThrow(/centavos/);
    await expect(registrarCompra(banco, { ...base, itens: [{ nome: "dudu", qtd: 1, precoCentavos: 250 }], pagoNaHoraCentavos: 300 })).rejects.toThrow(/maior/);
    await expect(registrarPagamento(banco, { ...base, valorCentavos: 0 })).rejects.toThrow(/maior que zero/);
  });

  it("vendas do mês alimentam a conta do lucro, com o valor combinado", async () => {
    const { negocio } = await garantirNegocio(banco, "5581999990000");
    const c = await criarCliente(banco, negocio.id, "Josué");
    await registrarCompra(banco, { negocioId: negocio.id, clienteId: c.id, ocorreuEm: "2026-11-10", itens: [{ nome: "dudu", qtd: 3, precoCentavos: 250, custoCentavos: 85 }], totalInformadoCentavos: 500, pagoNaHoraCentavos: 500, forma: "dinheiro" });
    await registrarCompra(banco, { negocioId: negocio.id, clienteId: c.id, ocorreuEm: "2026-10-30", itens: [{ nome: "dudu", qtd: 9, precoCentavos: 250, custoCentavos: 85 }] });
    const itens = await itensVendidos(banco, negocio.id, "2026-11-01", "2026-11-30");
    const r = resultadoPeriodo(itens, 1000);
    expect(r.receita).toBe(501); // 3 × 167 (5 reais rateados; arredondamento de 1 centavo)
    expect(r.unidades).toBe(3);
  });

  it("transação desfaz tudo se algo falhar no meio", async () => {
    const { negocio } = await garantirNegocio(banco, "5581999990000");
    await expect(
      transacao(banco, async (t) => {
        await criarCliente(t, negocio.id, "Fantasma");
        throw new Error("falhou depois");
      }),
    ).rejects.toThrow("falhou depois");
    expect((await banco.query("select count(*)::int as n from cliente")).rows[0].n).toBe(0);
  });

  it("migrar de novo não faz nada", async () => {
    await expect(migrar(banco)).resolves.toBeUndefined();
  });
});

class WhatsAppFalso implements Mensageiro {
  enviadas: { para: string; texto: string }[] = [];
  lidas: string[] = [];
  falharProximas = 0;
  async enviarTexto(para: string, texto: string) {
    if (this.falharProximas > 0) {
      this.falharProximas--;
      throw new ErroWhatsApp("Cloud API 503: indisponível", 503, {});
    }
    this.enviadas.push({ para, texto });
    return `wamid.saida.${this.enviadas.length}.${Math.random()}`;
  }
  async marcarLida(id: string) {
    this.lidas.push(id);
  }
}

describe("webhook de ponta a ponta (fase 0)", () => {
  const SEGREDO = "segredo-do-app";
  const DONA = "5581999991234";

  function montar() {
    const whatsapp = new WhatsAppFalso();
    const trabalhador = new Trabalhador(banco, criarProcessador({ banco, whatsapp, numerosPermitidos: new Set([DONA]) }), {
      ehTemporario: (e) => !(e instanceof ErroWhatsApp) || e.temporario,
    });
    const app = criarApp({ banco, appSecret: SEGREDO, verifyToken: "verifica-123", phoneNumberId: "PNID" });
    const postar = (corpo: object, assinatura?: string) => {
      const bruto = JSON.stringify(corpo);
      return app.request("/webhook", { method: "POST", body: bruto, headers: { "content-type": "application/json", "x-hub-signature-256": assinatura ?? assinar(bruto, SEGREDO) } });
    };
    return { whatsapp, trabalhador, app, postar };
  }
  const msg = (id: string, de: string, texto: string, ts = 1763740000) => ({
    object: "whatsapp_business_account",
    entry: [{ id: "1", changes: [{ field: "messages", value: { metadata: { phone_number_id: "PNID" }, messages: [{ from: de, id, timestamp: String(ts), type: "text", text: { body: texto } }] } }] }],
  });

  it("verificação do webhook pela Meta", async () => {
    const { app } = montar();
    const ok = await app.request("/webhook?hub.mode=subscribe&hub.verify_token=verifica-123&hub.challenge=4242");
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("4242");
    expect((await app.request("/webhook?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=1")).status).toBe(403);
    expect((await app.request("/saude")).status).toBe(200);
  });

  it("recusa assinatura inválida sem gravar nada", async () => {
    const { postar } = montar();
    const r = await postar(msg("wamid.a", DONA, "oi"), "sha256=" + "0".repeat(64));
    expect(r.status).toBe(401);
    expect((await banco.query("select count(*)::int as n from mensagem")).rows[0].n).toBe(0);
  });

  it("primeira mensagem dá boas-vindas; depois confirma o recebimento; webhook repetido não duplica", async () => {
    const { postar, trabalhador, whatsapp } = montar();
    expect((await postar(msg("wamid.1", DONA, "oi"))).status).toBe(200);
    expect((await postar(msg("wamid.1", DONA, "oi"))).status).toBe(200); // a Meta reenviou
    expect(await trabalhador.drenar()).toBe(1);
    await postar(msg("wamid.2", DONA, "Ana levou 3 dudu de morango", 1763740010));
    await trabalhador.drenar();

    expect(whatsapp.enviadas.map((e) => e.texto)).toEqual([TEXTO_BOAS_VINDAS, 'Recebi: "Ana levou 3 dudu de morango" ✍️\nAinda não sei anotar sozinho, mas já guardei.']);
    expect(whatsapp.enviadas.every((e) => e.para === DONA)).toBe(true);
    expect(whatsapp.lidas).toEqual(["wamid.1", "wamid.2"]);
    const neg = await banco.query("select count(*)::int as n from negocio where wa_id_dono = $1", [DONA]);
    expect(neg.rows[0].n).toBe(1);
    const st = await banco.query("select direcao, status, count(*)::int as n from mensagem group by 1, 2 order by 1, 2");
    expect(st.rows).toEqual([{ direcao: "entrada", status: "feita", n: 2 }, { direcao: "saida", status: "feita", n: 2 }]);
  });

  it("se a boas-vindas falhar, a nova tentativa ainda manda a boas-vindas", async () => {
    const { postar, trabalhador, whatsapp } = montar();
    whatsapp.falharProximas = 1;
    await postar(msg("wamid.1", DONA, "oi"));
    await trabalhador.drenar();
    await banco.query("update mensagem set tentar_depois = now()");
    await trabalhador.drenar();
    expect(whatsapp.enviadas.map((e) => e.texto)).toEqual([TEXTO_BOAS_VINDAS]);
  });

  it("número fora da lista do piloto é ignorado em silêncio", async () => {
    const { postar, trabalhador, whatsapp } = montar();
    await postar(msg("wamid.x", "5511988887777", "oi"));
    await trabalhador.drenar();
    expect(whatsapp.enviadas).toEqual([]);
    expect((await banco.query("select status from mensagem")).rows).toEqual([{ status: "ignorada" }]);
    expect((await banco.query("select count(*)::int as n from negocio")).rows[0].n).toBe(0);
  });

  it("falha temporária do WhatsApp: tenta de novo e mantém a ordem das mensagens", async () => {
    const { postar, trabalhador, whatsapp } = montar();
    await postar(msg("wamid.1", DONA, "oi", 1763740000));
    await trabalhador.drenar();
    whatsapp.falharProximas = 1;
    await postar(msg("wamid.2", DONA, "primeira", 1763740010));
    await postar(msg("wamid.3", DONA, "segunda", 1763740020));
    await trabalhador.drenar(); // wamid.2 falha e volta para a fila com espera; wamid.3 espera a vez dela
    expect(whatsapp.enviadas.length).toBe(1);
    const r = await banco.query("select status, tentativas, tentar_depois > now() as esperando from mensagem where wa_message_id = 'wamid.2'");
    expect(r.rows[0]).toEqual({ status: "pendente", tentativas: 1, esperando: true });
    await banco.query("update mensagem set tentar_depois = now() where wa_message_id = 'wamid.2'"); // o tempo passou
    await trabalhador.drenar();
    expect(whatsapp.enviadas.slice(1).map((e) => e.texto.split('"')[1])).toEqual(["primeira", "segunda"]);
  });

  it("o trabalhador em segundo plano responde sozinho quando avisado", async () => {
    const { whatsapp } = montar();
    const app2 = criarApp({ banco, appSecret: SEGREDO, verifyToken: "v", phoneNumberId: "PNID", aoEnfileirar: () => trabalhador.avisar() });
    const trabalhador = new Trabalhador(banco, criarProcessador({ banco, whatsapp, numerosPermitidos: new Set([DONA]) }), { intervaloMs: 60_000 });
    trabalhador.iniciar();
    const bruto = JSON.stringify(msg("wamid.bg", DONA, "oi"));
    await app2.request("/webhook", { method: "POST", body: bruto, headers: { "x-hub-signature-256": assinar(bruto, SEGREDO) } });
    for (let i = 0; i < 50 && !whatsapp.enviadas.length; i++) await new Promise((r) => setTimeout(r, 20));
    await trabalhador.parar();
    expect(whatsapp.enviadas.length).toBe(1);
  });
});
