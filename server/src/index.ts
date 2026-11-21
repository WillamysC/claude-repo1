import { serve } from "@hono/node-server";
import { criarApp } from "./app.js";
import { lerConfig } from "./config.js";
import { criarBanco, migrar } from "./db/banco.js";
import { recuperarTravadas, Trabalhador } from "./fila.js";
import { criarProcessador } from "./processar.js";
import { ErroWhatsApp, MensageiroCloudApi } from "./whatsapp/mensageiro.js";

const log = (m: string, e?: unknown) => (e ? console.error(`[caderninho] ${m}`, e) : console.log(`[caderninho] ${m}`));

const cfg = lerConfig();
const banco = criarBanco(cfg.DATABASE_URL);
await migrar(banco, log);
const recuperadas = await recuperarTravadas(banco);
if (recuperadas) log(`${recuperadas} mensagem(ns) voltaram para a fila`);

const whatsapp = new MensageiroCloudApi({ token: cfg.WHATSAPP_TOKEN, phoneNumberId: cfg.WHATSAPP_PHONE_NUMBER_ID, versao: cfg.GRAPH_API_VERSION });
const trabalhador = new Trabalhador(banco, criarProcessador({ banco, whatsapp, numerosPermitidos: cfg.NUMEROS_PERMITIDOS, log }), {
  log,
  ehTemporario: (e) => !(e instanceof ErroWhatsApp) || e.temporario,
});

const app = criarApp({
  banco,
  appSecret: cfg.WHATSAPP_APP_SECRET,
  verifyToken: cfg.WHATSAPP_VERIFY_TOKEN,
  phoneNumberId: cfg.WHATSAPP_PHONE_NUMBER_ID,
  aoEnfileirar: () => trabalhador.avisar(),
  log,
});

trabalhador.iniciar();
const servidor = serve({ fetch: app.fetch, port: cfg.PORT }, (i) => log(`ouvindo na porta ${i.port}`));
if (cfg.NUMEROS_PERMITIDOS.size === 0) log("atenção: NUMEROS_PERMITIDOS está vazio, o robô não vai responder ninguém");

async function desligar(sinal: string) {
  log(`${sinal}: desligando`);
  servidor.close();
  await trabalhador.parar();
  await banco.end();
  process.exit(0);
}
process.on("SIGTERM", () => void desligar("SIGTERM"));
process.on("SIGINT", () => void desligar("SIGINT"));
