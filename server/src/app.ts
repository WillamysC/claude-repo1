import { Hono } from "hono";
import type { Banco } from "./db/banco.js";
import { enfileirar } from "./fila.js";
import { assinaturaValida } from "./whatsapp/assinatura.js";
import { extrairMensagens } from "./whatsapp/webhook.js";

export interface DepsApp {
  banco: Banco;
  appSecret: string;
  verifyToken: string;
  phoneNumberId: string;
  /** Chamado depois de gravar mensagens novas, para o trabalhador acordar na hora. */
  aoEnfileirar?: () => void;
  log?: (m: string, e?: unknown) => void;
}

export function criarApp(d: DepsApp) {
  const app = new Hono();

  app.get("/saude", async (c) => {
    try {
      await d.banco.query("select 1");
      return c.json({ ok: true });
    } catch {
      return c.json({ ok: false }, 503);
    }
  });

  // Verificação feita pela Meta quando você cadastra a URL do webhook.
  app.get("/webhook", (c) => {
    const mode = c.req.query("hub.mode");
    const token = c.req.query("hub.verify_token");
    const challenge = c.req.query("hub.challenge");
    if (mode === "subscribe" && token === d.verifyToken && challenge) return c.text(challenge);
    return c.text("token inválido", 403);
  });

  // Mensagens: valida a assinatura, grava e responde 200 rápido. O processamento é na fila.
  app.post("/webhook", async (c) => {
    const bruto = Buffer.from(await c.req.arrayBuffer());
    if (!assinaturaValida(bruto, c.req.header("x-hub-signature-256"), d.appSecret)) {
      d.log?.("webhook com assinatura inválida recusado");
      return c.text("assinatura inválida", 401);
    }
    let json: unknown;
    try {
      json = JSON.parse(bruto.toString("utf8"));
    } catch {
      return c.text("json inválido", 400);
    }
    const msgs = extrairMensagens(json, d.phoneNumberId);
    try {
      let novas = 0;
      for (const m of msgs) if (await enfileirar(d.banco, m)) novas++;
      if (novas) d.aoEnfileirar?.();
    } catch (e) {
      d.log?.("falha ao gravar mensagem; a Meta vai reenviar", e);
      return c.text("erro", 500);
    }
    return c.text("ok");
  });

  return app;
}
