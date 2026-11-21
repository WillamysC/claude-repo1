/**
 * Migrações em ordem. Cada uma roda uma vez, dentro de uma transação.
 * Nunca edite uma migração que já rodou em produção: crie a próxima.
 */
export const MIGRACOES: { nome: string; sql: string }[] = [
  {
    nome: "001_inicial",
    sql: /* sql */ `
create extension if not exists pg_trgm;
create extension if not exists unaccent;

create table negocio (
  id                   uuid primary key default gen_random_uuid(),
  wa_id_dono           text not null unique,          -- telefone de quem conversa com o robô (só dígitos)
  nome                 text,
  pix_chave            text,
  pix_nome             text,
  pix_cidade           text,
  fuso                 text not null default 'America/Recife',
  meta_lucro_centavos  bigint check (meta_lucro_centavos >= 0),
  criado_em            timestamptz not null default now()
);

create table cliente (
  id               uuid primary key default gen_random_uuid(),
  negocio_id       uuid not null references negocio(id) on delete cascade,
  nome             text not null,
  apelidos         text[] not null default '{}',
  telefone         text,
  limite_centavos  bigint check (limite_centavos >= 0),
  arquivado        boolean not null default false,
  criado_em        timestamptz not null default now()
);
create index cliente_negocio_idx on cliente (negocio_id);
create index cliente_nome_trgm on cliente using gin (nome gin_trgm_ops);

create table produto (
  id              uuid primary key default gen_random_uuid(),
  negocio_id      uuid not null references negocio(id) on delete cascade,
  nome            text not null,
  apelidos        text[] not null default '{}',
  preco_centavos  bigint not null check (preco_centavos >= 0),
  custo_centavos  bigint check (custo_centavos >= 0),   -- null = não informado
  ativo           boolean not null default true,
  criado_em       timestamptz not null default now()
);
create index produto_negocio_idx on produto (negocio_id);

create table custo_fixo (
  id              uuid primary key default gen_random_uuid(),
  negocio_id      uuid not null references negocio(id) on delete cascade,
  nome            text not null,
  valor_centavos  bigint not null check (valor_centavos >= 0),
  vigente_desde   date not null default current_date,
  vigente_ate     date
);

create table mensagem (
  id              uuid primary key default gen_random_uuid(),
  negocio_id      uuid references negocio(id) on delete cascade,
  wa_message_id   text unique,                          -- idempotência: a Meta reenvia webhooks
  wa_de           text not null,                        -- quem mandou (entrada) ou para quem (saída)
  direcao         text not null check (direcao in ('entrada', 'saida')),
  tipo            text not null,                        -- texto | audio | botao | outro
  conteudo        text,
  midia_id        text,
  transcricao     text,
  interpretacao   jsonb,
  status          text not null default 'pendente'
                  check (status in ('pendente', 'processando', 'feita', 'erro', 'ignorada')),
  tentativas      int not null default 0,
  tentar_depois   timestamptz,                          -- espera antes de tentar de novo depois de erro
  erro            text,
  recebida_em     timestamptz not null,                 -- horário do WhatsApp
  criado_em       timestamptz not null default now(),
  processada_em   timestamptz
);
create index mensagem_fila_idx on mensagem (status, criado_em) where status in ('pendente', 'processando');

create type tipo_lancamento as enum ('compra', 'pagamento', 'estorno', 'ajuste');

-- Livro-razão: só INSERT. Nunca UPDATE ou DELETE (ver gatilho abaixo).
create table lancamento (
  id                     uuid primary key default gen_random_uuid(),
  negocio_id             uuid not null references negocio(id) on delete cascade,
  cliente_id             uuid not null references cliente(id) on delete cascade,
  tipo                   tipo_lancamento not null,
  valor_centavos         bigint not null,   -- efeito no saldo: + aumenta a dívida, − diminui
  total_centavos         bigint,            -- compra: valor total da compra (pago + fiado)
  pago_na_hora_centavos  bigint not null default 0 check (pago_na_hora_centavos >= 0),
  itens                  jsonb,             -- [{produto_id, nome, qtd, preco_centavos, custo_centavos}]
  forma                  text check (forma in ('pix', 'dinheiro', 'cartao')),
  ocorreu_em             date not null,
  estorna_id             uuid unique references lancamento(id),
  mensagem_id            uuid references mensagem(id) on delete cascade, -- mensagens só somem junto com o negócio
  origem                 text not null default 'whatsapp' check (origem in ('whatsapp', 'painel')),
  criado_em              timestamptz not null default now()
);
create index lancamento_cliente_idx on lancamento (negocio_id, cliente_id, ocorreu_em);

create function lancamento_imutavel() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old; -- permitido só em cascata (exclusão da conta inteira)
  end if;
  raise exception 'lancamento é só de acréscimo: use um estorno';
end $$;
create trigger lancamento_sem_update before update on lancamento
  for each row execute function lancamento_imutavel();
create trigger lancamento_sem_delete before delete on lancamento
  for each row execute function lancamento_imutavel();

create view saldo_cliente as
  select c.negocio_id, c.id as cliente_id, coalesce(sum(l.valor_centavos), 0)::bigint as saldo_centavos
  from cliente c left join lancamento l on l.cliente_id = c.id
  group by c.negocio_id, c.id;

create table pergunta_pendente (
  negocio_id  uuid primary key references negocio(id) on delete cascade,
  operacao    jsonb not null,
  opcoes      jsonb not null,
  expira_em   timestamptz not null
);
`,
  },
];
