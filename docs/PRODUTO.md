# Caderninho: clientes, vendas e fiado de quem vende pelo WhatsApp

## O problema

Muito pequeno negócio vive dentro do WhatsApp. O cliente chega por lá, pede por lá, combina o horário por lá e paga no Pix que foi mandado por lá. Dois exemplos:

- **Quem vende dudu (geladinho/sacolé)**: venda pequena e frequente, muita coisa "anotada pra pagar depois". O controle do fiado fica num caderno de papel, na memória ou espalhado em conversas. Cobrar é constrangedor, e sem lista fica fácil esquecer quem deve quanto.
- **Técnico de refrigeração**: menos vendas, de valor maior. Precisa de agenda, endereço, histórico do equipamento e, principalmente, **lembrar de chamar o cliente de volta** para a manutenção (limpeza de split a cada 6 meses). Empresas pagam depois (fiado/faturado) e também precisam ser cobradas.

As soluções de "CRM com WhatsApp" do mercado querem **trazer o atendimento para dentro delas** (caixa de entrada compartilhada, chatbot). Para esse público isso atrapalha: a pessoa já sabe atender no WhatsApp e não quer trocar de app pra conversar.

## A ideia

**O atendimento continua no WhatsApp. O Caderninho é o caderno que fica do lado.**

O app guarda o que o WhatsApp não guarda bem (quem é cliente, o que comprou, quanto deve, quando volta) e, em cada momento importante, **escreve a mensagem certa e abre a conversa já pronta** no WhatsApp. A pessoa confere e aperta enviar.

| Momento | O que o Caderninho faz | Mensagem gerada |
|---|---|---|
| Vendeu | Anota a venda: paga, fiado ou parte paga | Comprovante com itens, total e saldo |
| Recebeu | Abate o pagamento do fiado, do mais antigo pro mais novo | Confirmação com o saldo que restou |
| Fiado passou de X dias | Põe o cliente na lista "Pra cobrar" | Cobrança gentil com a lista do que está em aberto e o Pix |
| Marcou serviço | Agenda com dia, hora e endereço | Confirmação do agendamento |
| Serviço com retorno venceu | Põe na lista "Hora da manutenção" | Convite pra agendar a manutenção |
| Cliente sumiu | Põe na lista "Faz tempo que não compra" | Mensagem de reativação |

Todas as mensagens são editáveis em **Ajustes** e usam campos como `{nome}`, `{valor}`, `{itens}`, `{pix}`.

## Gestão do fiado (o coração do app)

- **Saldo por cliente** = vendas não pagas − pagamentos.
- **Pagamento parcial** abate as compras mais antigas primeiro, como no caderno de papel. Assim dá pra dizer "falta só a compra do dia 06/11".
- **Idade do fiado**: conta os dias desde a compra mais antiga ainda em aberto. Passou do prazo definido em Ajustes (padrão 7 dias), o cliente entra em "Pra cobrar".
- **Limite de fiado por cliente**: ao anotar uma venda que passa do limite, o app avisa (não bloqueia; quem decide é o vendedor).
- **Registro de cobrança**: ao tocar em "Cobrar", fica anotado "cobrado hoje", pra não cobrar a mesma pessoa duas vezes no mesmo dia.
- **Venda com parte paga**: "levou 5, pagou 3 no Pix e ficou devendo 2" é um caso comum e tem botão próprio.

## O que já existe (protótipo em `app/index.html`)

Um único arquivo HTML, sem servidor, que funciona no navegador do celular:

- Início com resumo do mês, fiado total e as listas de ação (cobrar, agenda, manutenção, sumidos)
- Clientes com busca, filtros e ficha individual (saldo, em aberto, histórico)
- Venda rápida com catálogo em botões, item avulso e quantidade
- Fiado com todos os devedores ordenados por atraso
- Agenda (para quem presta serviço); concluir um serviço já abre a venda
- Catálogo com "retorno em N dias"
- Mensagens editáveis, backup (copiar/baixar/restaurar) e dois exemplos prontos (dudus e refrigeração)

Os dados ficam **só no aparelho** (localStorage). Por isso existe o backup.

## Como ele se integra ao WhatsApp (níveis)

1. **Link `wa.me` com texto pronto (feito).** Funciona com qualquer WhatsApp, pessoal ou Business, sem cadastro, sem custo e sem risco de bloqueio. A mensagem sai do número da própria pessoa. Limitação: um clique por mensagem.
2. **Lista de transmissão assistida.** Gerar a cobrança de vários clientes em sequência (abre um, envia, volta, abre o próximo). Continua no nível 1, só agiliza.
3. **WhatsApp Business Platform (Cloud API oficial da Meta).** Permite enviar lembretes automáticos (mensagens de "template" aprovadas) e receber mensagens num webhook. Exige número dedicado ou migração do número, verificação do negócio e tem custo por conversa iniciada pela empresa. Faz sentido só quando o volume justificar.
4. **Ler pedidos que chegam.** Com a API oficial, dá pra transformar "me vê 10 dudus de ninho" numa venda pré-preenchida para o vendedor só confirmar. É o passo mais caro; só vale com o resto validado.

Ferramentas não oficiais que "espelham" o WhatsApp Web (automação pelo QR code) não são recomendadas: violam os termos do WhatsApp e o número pode ser banido, o que para esse público é perder o negócio.

## Próximos passos sugeridos

1. **Testar com a amiga dos dudus por 2 semanas** usando o protótipo como está. Observar: ela anota toda venda? Usa o botão Cobrar? O que fica faltando?
2. **Testar com um técnico de refrigeração**, focando agenda e retornos.
3. **Sincronizar entre aparelhos** (login + banco na nuvem) quando alguém tiver ajudante ou trocar de celular. Hoje o backup manual cobre isso.
4. **Pix com valor**: gerar o "Pix copia e cola" com o valor exato da cobrança dentro da mensagem.
5. **Relatórios simples**: quem mais compra, produto que mais sai, fiado que virou prejuízo.
6. Instalar como app (PWA, ícone na tela inicial e funcionamento offline).

## Perguntas em aberto

- Cobrar por isso? Quanto? Uma hipótese é grátis até N clientes e um valor mensal baixo depois.
- Os dados devem ficar só no aparelho (privacidade e simplicidade) ou na nuvem (segurança contra perda do celular)?
- Vale um modo "cliente vê o próprio extrato" por link, para reduzir a conversa de cobrança?
