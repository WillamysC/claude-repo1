import { z } from "zod";

const Esquema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, "Defina DATABASE_URL (ex.: postgres://usuario:senha@host:5432/caderninho)"),
  /** Token de acesso da Cloud API (permanente, de usuário do sistema). */
  WHATSAPP_TOKEN: z.string().min(1, "Defina WHATSAPP_TOKEN"),
  /** ID do número que envia (Phone number ID, não o número em si). */
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1, "Defina WHATSAPP_PHONE_NUMBER_ID"),
  /** Chave secreta do app na Meta: valida a assinatura X-Hub-Signature-256 do webhook. */
  WHATSAPP_APP_SECRET: z.string().min(1, "Defina WHATSAPP_APP_SECRET"),
  /** Texto livre que você cadastra no painel da Meta ao configurar o webhook. */
  WHATSAPP_VERIFY_TOKEN: z.string().min(1, "Defina WHATSAPP_VERIFY_TOKEN"),
  GRAPH_API_VERSION: z.string().default("v21.0"),
  /** Números (só dígitos, com 55) que podem usar o robô no piloto, separados por vírgula. Vazio = ninguém. */
  NUMEROS_PERMITIDOS: z
    .string()
    .default("")
    .transform((s) => new Set(s.split(",").map((n) => n.replace(/\D/g, "")).filter(Boolean))),
  FUSO: z.string().default("America/Recife"),
});

export type Config = z.infer<typeof Esquema>;

export function lerConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const r = Esquema.safeParse(env);
  if (!r.success) {
    const faltas = r.error.issues.map((i) => `- ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Configuração inválida:\n${faltas}`);
  }
  return r.data;
}
