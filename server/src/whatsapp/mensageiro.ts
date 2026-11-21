/** O que o resto do sistema precisa do WhatsApp. Nos testes entra um falso que só anota. */
export interface Mensageiro {
  /** Envia texto e devolve o id da mensagem criada pela Meta. */
  enviarTexto(para: string, texto: string): Promise<string | undefined>;
  /** Marca como lida (dois tiques azuis), para ela ver que chegou. */
  marcarLida(waMessageId: string): Promise<void>;
}

export class ErroWhatsApp extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly corpo: unknown,
  ) {
    super(message);
  }
  /** 429 e 5xx valem nova tentativa; o resto (token vencido, número fora da janela) não. */
  get temporario(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

/** Limite de texto da Cloud API. */
export const MAX_TEXTO = 4096;

export class MensageiroCloudApi implements Mensageiro {
  constructor(
    private readonly opts: { token: string; phoneNumberId: string; versao: string; fetch?: typeof fetch },
  ) {}

  private async post(corpo: object): Promise<any> {
    const f = this.opts.fetch ?? fetch;
    const r = await f(`https://graph.facebook.com/${this.opts.versao}/${this.opts.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.opts.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(15_000),
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = (json as any)?.error?.message ?? r.statusText;
      throw new ErroWhatsApp(`Cloud API ${r.status}: ${msg}`, r.status, json);
    }
    return json;
  }

  async enviarTexto(para: string, texto: string): Promise<string | undefined> {
    const body = texto.length > MAX_TEXTO ? texto.slice(0, MAX_TEXTO - 1) + "…" : texto;
    const r = await this.post({ messaging_product: "whatsapp", recipient_type: "individual", to: para, type: "text", text: { preview_url: false, body } });
    return r?.messages?.[0]?.id;
  }

  async marcarLida(waMessageId: string): Promise<void> {
    await this.post({ messaging_product: "whatsapp", status: "read", message_id: waMessageId });
  }
}
