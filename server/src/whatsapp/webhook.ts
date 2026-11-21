import { z } from "zod";

/**
 * Formato do webhook da WhatsApp Cloud API (campo "messages").
 * Só validamos o que usamos; o resto passa sem quebrar, porque a Meta acrescenta campos com o tempo.
 */
const MensagemWa = z
  .object({
    from: z.string(),
    id: z.string(),
    timestamp: z.string(),
    type: z.string(),
    text: z.object({ body: z.string() }).optional(),
    audio: z.object({ id: z.string(), mime_type: z.string().optional(), voice: z.boolean().optional() }).optional(),
    interactive: z
      .object({
        type: z.string(),
        button_reply: z.object({ id: z.string(), title: z.string() }).optional(),
        list_reply: z.object({ id: z.string(), title: z.string() }).optional(),
      })
      .optional(),
    button: z.object({ text: z.string(), payload: z.string().optional() }).optional(),
  })
  .passthrough();

const Payload = z
  .object({
    object: z.string(),
    entry: z.array(
      z
        .object({
          changes: z.array(
            z
              .object({
                field: z.string(),
                value: z
                  .object({
                    metadata: z.object({ phone_number_id: z.string() }).passthrough().optional(),
                    contacts: z.array(z.object({ wa_id: z.string(), profile: z.object({ name: z.string() }).optional() }).passthrough()).optional(),
                    messages: z.array(MensagemWa).optional(),
                  })
                  .passthrough(),
              })
              .passthrough(),
          ),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export type TipoMensagem = "texto" | "audio" | "botao" | "outro";

export interface MensagemRecebida {
  waMessageId: string;
  de: string; // wa_id de quem mandou (só dígitos)
  nomePerfil?: string;
  tipo: TipoMensagem;
  conteudo?: string; // texto, ou id do botão/lista
  midiaId?: string; // áudio
  recebidaEm: Date;
}

/** Extrai as mensagens do payload que são para o nosso número. Status de entrega e afins são ignorados. */
export function extrairMensagens(json: unknown, phoneNumberId: string): MensagemRecebida[] {
  const r = Payload.safeParse(json);
  if (!r.success || r.data.object !== "whatsapp_business_account") return [];
  const out: MensagemRecebida[] = [];
  for (const entry of r.data.entry) {
    for (const ch of entry.changes) {
      if (ch.field !== "messages") continue;
      const v = ch.value;
      if (v.metadata && v.metadata.phone_number_id !== phoneNumberId) continue;
      for (const m of v.messages ?? []) {
        const nome = v.contacts?.find((c) => c.wa_id === m.from)?.profile?.name;
        const base = { waMessageId: m.id, de: m.from.replace(/\D/g, ""), nomePerfil: nome, recebidaEm: new Date(Number(m.timestamp) * 1000) };
        if (m.type === "text" && m.text) out.push({ ...base, tipo: "texto", conteudo: m.text.body });
        else if (m.type === "audio" && m.audio) out.push({ ...base, tipo: "audio", midiaId: m.audio.id });
        else if (m.type === "interactive" && m.interactive) {
          const resp = m.interactive.button_reply ?? m.interactive.list_reply;
          out.push({ ...base, tipo: "botao", conteudo: resp?.id ?? resp?.title });
        } else if (m.type === "button" && m.button) out.push({ ...base, tipo: "botao", conteudo: m.button.payload ?? m.button.text });
        else out.push({ ...base, tipo: "outro" });
      }
    }
  }
  return out;
}

/**
 * Celulares brasileiros às vezes chegam do WhatsApp sem o nono dígito (55 81 9999-1234 → 558199991234).
 * Devolve as duas formas para comparar com a lista de números permitidos.
 */
export function variantesNumeroBR(numero: string): string[] {
  const d = numero.replace(/\D/g, "");
  const m13 = d.match(/^55(\d{2})9(\d{8})$/);
  if (m13) return [d, `55${m13[1]}${m13[2]}`];
  const m12 = d.match(/^55(\d{2})([6-9]\d{7})$/);
  if (m12) return [d, `55${m12[1]}9${m12[2]}`];
  return [d];
}

export function numeroPermitido(numero: string, permitidos: Set<string>): boolean {
  return variantesNumeroBR(numero).some((v) => permitidos.has(v));
}
