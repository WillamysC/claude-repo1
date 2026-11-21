import type { Banco } from "./db/banco.js";
import { garantirNegocio } from "./dominio/livro.js";
import { concluir, registrarSaida, type MensagemFila } from "./fila.js";
import type { Mensageiro } from "./whatsapp/mensageiro.js";
import { numeroPermitido } from "./whatsapp/webhook.js";

export interface Deps {
  banco: Banco;
  whatsapp: Mensageiro;
  numerosPermitidos: Set<string>;
  log?: (m: string, e?: unknown) => void;
}

export const TEXTO_BOAS_VINDAS =
  "Oi! Eu sou o Caderninho 📒\n" +
  "Vou anotar suas vendas, o fiado e os pagamentos, do jeito que você já escreve aqui.\n\n" +
  "Ainda estou aprendendo: por enquanto só confirmo que recebi. Logo você vai poder mandar coisas como:\n" +
  "• _Ana levou 3 dudu de morango, fiado_\n" +
  "• _Josué pagou 20_\n" +
  "• _Quem tá devendo?_";

/**
 * Fase 0 do plano: confirma que a mensagem chegou e cria o negócio na primeira conversa.
 * A interpretação com o Claude (fase 1) entra aqui, no lugar do eco.
 */
export function criarProcessador(d: Deps) {
  return async function processar(m: MensagemFila): Promise<void> {
    if (!numeroPermitido(m.wa_de, d.numerosPermitidos)) {
      // Piloto fechado: não responde quem não está na lista (nem gasta mensagem).
      d.log?.(`mensagem de número fora da lista ignorada: ${m.wa_de.slice(0, 4)}…`);
      await concluir(d.banco, m.id, "ignorada");
      return;
    }
    const { negocio } = await garantirNegocio(d.banco, m.wa_de);
    // "Primeira conversa" = o robô ainda não conseguiu responder nada. Assim, se o envio da
    // boas-vindas falhar e a mensagem for tentada de novo, a boas-vindas não se perde.
    const jaRespondeu = await d.banco.query("select 1 from mensagem where negocio_id = $1 and direcao = 'saida' limit 1", [negocio.id]);
    const novo = jaRespondeu.rowCount === 0;
    d.whatsapp.marcarLida(m.wa_message_id).catch((e) => d.log?.("não consegui marcar como lida", e));

    let resposta: string;
    if (novo) resposta = TEXTO_BOAS_VINDAS;
    else if (m.tipo === "texto") resposta = `Recebi: "${(m.conteudo ?? "").slice(0, 300)}" ✍️\nAinda não sei anotar sozinho, mas já guardei.`;
    else if (m.tipo === "audio") resposta = "Recebi seu áudio 🎙️ Ainda não sei ouvir, mas logo vou entender áudios também.";
    else resposta = "Por enquanto eu entendo só texto. 🙂";

    const id = await d.whatsapp.enviarTexto(m.wa_de, resposta);
    await registrarSaida(d.banco, m.wa_de, resposta, id, negocio.id);
    await concluir(d.banco, m.id, "feita", { negocioId: negocio.id });
  };
}
