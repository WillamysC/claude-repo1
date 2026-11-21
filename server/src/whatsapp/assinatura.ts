import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Confere o cabeçalho X-Hub-Signature-256 ("sha256=<hex>") que a Meta manda em todo webhook.
 * A assinatura é o HMAC-SHA256 do corpo BRUTO (bytes exatos) com a chave secreta do app.
 */
export function assinaturaValida(corpoBruto: string | Buffer, cabecalho: string | undefined | null, segredo: string): boolean {
  if (!cabecalho?.startsWith("sha256=")) return false;
  const recebida = Buffer.from(cabecalho.slice("sha256=".length), "hex");
  const esperada = createHmac("sha256", segredo).update(corpoBruto).digest();
  return recebida.length === esperada.length && timingSafeEqual(recebida, esperada);
}

export function assinar(corpoBruto: string | Buffer, segredo: string): string {
  return "sha256=" + createHmac("sha256", segredo).update(corpoBruto).digest("hex");
}
