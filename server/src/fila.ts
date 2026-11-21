import { EventEmitter } from "node:events";
import type { Banco } from "./db/banco.js";
import type { MensagemRecebida } from "./whatsapp/webhook.js";

export interface MensagemFila {
  id: string;
  wa_message_id: string;
  wa_de: string;
  tipo: MensagemRecebida["tipo"];
  conteudo: string | null;
  midia_id: string | null;
  tentativas: number;
  recebida_em: Date;
}

const MAX_TENTATIVAS = 3;

/** Grava a mensagem para processar depois. Devolve false se ela já tinha chegado (webhook repetido). */
export async function enfileirar(banco: Banco, m: MensagemRecebida): Promise<boolean> {
  const r = await banco.query(
    `insert into mensagem (wa_message_id, wa_de, direcao, tipo, conteudo, midia_id, recebida_em)
     values ($1, $2, 'entrada', $3, $4, $5, $6)
     on conflict (wa_message_id) do nothing`,
    [m.waMessageId, m.de, m.tipo, m.conteudo ?? null, m.midiaId ?? null, m.recebidaEm],
  );
  return (r.rowCount ?? 0) > 0;
}

/**
 * Pega a próxima mensagem pendente. Mensagens da mesma pessoa saem em ordem e nunca duas ao mesmo tempo,
 * para "Ana levou 3" e logo depois "desfaz" não se cruzarem.
 */
export async function pegarProxima(banco: Banco): Promise<MensagemFila | null> {
  const r = await banco.query<MensagemFila>(
    `update mensagem set status = 'processando', tentativas = tentativas + 1
      where id = (
        select m.id from mensagem m
         where m.status = 'pendente' and m.direcao = 'entrada'
           and coalesce(m.tentar_depois, '-infinity') <= now()
           and not exists (select 1 from mensagem o where o.wa_de = m.wa_de and o.direcao = 'entrada' and o.status = 'processando')
           and not exists (select 1 from mensagem a where a.wa_de = m.wa_de and a.direcao = 'entrada' and a.status = 'pendente'
                             and (a.recebida_em, a.criado_em) < (m.recebida_em, m.criado_em))
         order by m.recebida_em, m.criado_em
         limit 1
         for update skip locked)
      returning id, wa_message_id, wa_de, tipo, conteudo, midia_id, tentativas, recebida_em`,
  );
  return r.rows[0] ?? null;
}

export async function concluir(banco: Banco, id: string, status: "feita" | "ignorada", extra: { negocioId?: string } = {}): Promise<void> {
  await banco.query("update mensagem set status = $2, negocio_id = coalesce($3, negocio_id), processada_em = now(), erro = null where id = $1", [
    id,
    status,
    extra.negocioId ?? null,
  ]);
}

/** Erro: volta para a fila até MAX_TENTATIVAS, com espera crescente (10 s, 40 s), depois fica marcada como erro para olhar à mão. */
export async function falhar(banco: Banco, m: MensagemFila, erro: unknown, temporario: boolean): Promise<"repetir" | "desistir"> {
  const repetir = temporario && m.tentativas < MAX_TENTATIVAS;
  await banco.query(
    `update mensagem set status = $2, erro = $3,
            tentar_depois = case when $2 = 'pendente' then now() + make_interval(secs => $4) else null end,
            processada_em = case when $2 = 'erro' then now() else null end
      where id = $1`,
    [m.id, repetir ? "pendente" : "erro", String(erro instanceof Error ? erro.message : erro).slice(0, 2000), 10 * 4 ** (m.tentativas - 1)],
  );
  return repetir ? "repetir" : "desistir";
}

/** Se o processo caiu no meio, devolve para a fila o que ficou "processando". */
export async function recuperarTravadas(banco: Banco, minutos = 5): Promise<number> {
  const r = await banco.query(
    "update mensagem set status = 'pendente' where status = 'processando' and direcao = 'entrada' and criado_em < now() - make_interval(mins => $1)",
    [minutos],
  );
  return r.rowCount ?? 0;
}

export async function registrarSaida(banco: Banco, para: string, texto: string, waMessageId: string | undefined, negocioId?: string): Promise<void> {
  await banco.query(
    `insert into mensagem (wa_message_id, wa_de, direcao, tipo, conteudo, status, recebida_em, negocio_id, processada_em)
     values ($1, $2, 'saida', 'texto', $3, 'feita', now(), $4, now())
     on conflict (wa_message_id) do nothing`,
    [waMessageId ?? null, para, texto, negocioId ?? null],
  );
}

export type Processador = (m: MensagemFila) => Promise<void>;

/**
 * Laço que consome a fila. Acorda na hora quando chega mensagem (avisar()) e,
 * por segurança, a cada `intervaloMs` (mensagens que voltaram para a fila).
 */
export class Trabalhador {
  private parado = false;
  private rodando: Promise<void> | null = null;
  private readonly sinal = new EventEmitter();

  constructor(
    private readonly banco: Banco,
    private readonly processar: Processador,
    private readonly opts: { intervaloMs?: number; log?: (m: string, e?: unknown) => void; ehTemporario?: (e: unknown) => boolean } = {},
  ) {}

  avisar(): void {
    this.sinal.emit("acorda");
  }

  iniciar(): void {
    this.parado = false;
    this.rodando = this.laco();
  }

  async parar(): Promise<void> {
    this.parado = true;
    this.avisar();
    await this.rodando;
  }

  /** Processa tudo que estiver pendente agora e volta. Útil nos testes. */
  async drenar(): Promise<number> {
    let n = 0;
    for (let m = await pegarProxima(this.banco); m; m = await pegarProxima(this.banco)) {
      await this.um(m);
      n++;
    }
    return n;
  }

  private async um(m: MensagemFila): Promise<void> {
    try {
      await this.processar(m);
    } catch (e) {
      const temporario = this.opts.ehTemporario?.(e) ?? true;
      const r = await falhar(this.banco, m, e, temporario);
      this.opts.log?.(`mensagem ${m.wa_message_id}: erro (${r})`, e);
    }
  }

  private async laco(): Promise<void> {
    while (!this.parado) {
      try {
        await this.drenar();
      } catch (e) {
        this.opts.log?.("fila: erro ao ler o banco", e);
      }
      if (this.parado) break;
      await new Promise<void>((ok) => {
        const t = setTimeout(fim, this.opts.intervaloMs ?? 2000);
        this.sinal.once("acorda", fim);
        function fim() {
          clearTimeout(t);
          ok();
        }
      });
    }
  }
}
