# Servidor do Caderninho (robô do WhatsApp)

Recebe as mensagens da vendedora pela **WhatsApp Cloud API** (oficial da Meta), guarda numa fila no Postgres e responde. O plano completo está em [`../docs/ARQUITETURA.md`](../docs/ARQUITETURA.md).

## Situação

| Fase | Estado |
|---|---|
| **0. Fundação** | ✅ Pronta: webhook com assinatura verificada, fila com ordem e novas tentativas, banco com o livro-razão, boas-vindas e eco |
| Núcleo do livro-razão | ✅ Pronto e testado (compra, pagamento, estorno, saldo, fiado do mais antigo pro mais novo, devedores) |
| Pix copia-e-cola, ponto de equilíbrio e textos de confirmação | ✅ Prontos e testados, ainda não ligados às mensagens |
| 1. Entender as mensagens (Claude) | ⏳ Próxima fase |
| 2. Áudio, cobrança, painel · 2b. Lucro pelo WhatsApp | ⏳ |

Hoje o robô responde a boas-vindas na primeira mensagem e depois só confirma que recebeu. Tudo fica gravado.

## Rodar no seu computador

Precisa de Node 22 e de um Postgres 16 (o `docker-compose.yml` sobe um).

```bash
cd server
npm install
docker compose up -d          # Postgres local (ou use um seu e ajuste DATABASE_URL)
cp .env.example .env          # preencha com os dados da Meta (passo a passo abaixo)
npm test                      # 28 testes; usa o Postgres local
npm run dev                   # servidor em http://localhost:3000
```

O servidor cria as tabelas sozinho ao subir. Para fazer só isso: `npm run migrate`.

Os testes criam um banco `caderninho_teste` a partir de `TEST_DATABASE_URL` (padrão: `postgres://caderninho:caderninho@localhost:5432/caderninho`).

## Ligar ao WhatsApp (passo a passo na Meta)

A Meta muda os nomes das telas com frequência; se algo estiver diferente, a documentação oficial da Cloud API tem o guia "Get Started".

1. **Criar o app.** Em [developers.facebook.com](https://developers.facebook.com), crie um app do tipo **Empresa** e adicione o produto **WhatsApp**. A Meta cria uma conta de WhatsApp Business de teste com um **número de teste gratuito**.
2. **Cadastrar quem vai testar.** Em *WhatsApp → Configuração da API*, adicione o número da sua amiga (e o seu) como destinatários. O número de teste aceita até 5. Cada um recebe um código para confirmar.
3. **Copiar os dados para o `.env`:**
   - *ID do número de telefone* → `WHATSAPP_PHONE_NUMBER_ID`
   - *Token de acesso* → `WHATSAPP_TOKEN`. O token temporário vence em 24 h; para o piloto, gere um **token permanente** com um *usuário do sistema* no Gerenciador de Negócios, com as permissões `whatsapp_business_messaging` e `whatsapp_business_management`.
   - *Configurações do app → Básico → Chave secreta do app* → `WHATSAPP_APP_SECRET`
   - Os mesmos números do passo 2 → `NUMEROS_PERMITIDOS` (com 55 e DDD)
4. **Publicar o servidor** numa URL com HTTPS (veja abaixo). Para testar do seu computador, um túnel como `cloudflared tunnel --url http://localhost:3000` ou `ngrok http 3000` serve.
5. **Configurar o webhook.** Em *WhatsApp → Configuração*, coloque a URL `https://SEU-ENDERECO/webhook` e, em *Verificar token*, o mesmo texto de `WHATSAPP_VERIFY_TOKEN`. Clique em verificar. Depois, em *Campos do webhook*, assine **messages**.
6. **Testar.** Do celular cadastrado, mande "oi" para o número de teste. A resposta deve ser a boas-vindas do Caderninho.

## Publicar (hospedagem)

Qualquer serviço que rode um container serve (Fly.io, Railway, Render). O `Dockerfile` já está pronto.

- Banco: um Postgres gerenciado (Supabase ou Neon têm plano gratuito). As extensões `pg_trgm` e `unaccent` precisam estar disponíveis; nos dois estão.
- Variáveis de ambiente: as mesmas do `.env.example`, cadastradas como segredos no provedor.
- Rode **uma instância** só. A fila funciona com mais, mas a ordem das mensagens foi pensada para uma no piloto.
- Saúde: `GET /saude` responde `{"ok":true}` quando o banco está acessível.

## Como funciona por dentro

- `POST /webhook` confere a assinatura `X-Hub-Signature-256` sobre o corpo bruto, grava cada mensagem e responde 200 na hora. A Meta reenvia webhooks; o id da mensagem é único no banco, então nada duplica.
- Um trabalhador no mesmo processo consome a fila: mensagens da mesma pessoa saem em ordem e uma por vez. Erro temporário do WhatsApp (429, 5xx, rede) volta para a fila com espera de 10 s e depois 40 s; na terceira falha fica marcado como `erro` no banco.
- Números fora de `NUMEROS_PERMITIDOS` são ignorados sem resposta.
- O livro-razão (`lancamento`) só aceita inserção: o próprio banco recusa `UPDATE` e `DELETE`. Corrigir é estornar. Excluir a conta inteira continua possível (apaga em cascata).
- Dinheiro é sempre centavos inteiros.

| Pasta | O quê |
|---|---|
| `src/app.ts` | Rotas HTTP (`/webhook`, `/saude`) |
| `src/fila.ts` | Fila no Postgres e o trabalhador |
| `src/processar.ts` | O que fazer com cada mensagem (hoje: boas-vindas e eco) |
| `src/whatsapp/` | Assinatura, leitura do webhook, envio pela Cloud API |
| `src/dominio/` | Livro-razão, Pix, ponto de equilíbrio, textos das respostas |
| `src/db/` | Conexão e migrações |
| `test/` | Testes (unidade e com banco) |
