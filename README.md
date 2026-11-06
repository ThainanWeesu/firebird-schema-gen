# firebird-schema-gen

Lê os metadados do Firebird 2.5.9 (`RDB$...`) e grava um `.sql` por objeto, no padrão do `weesu-sql/DDL/firebird` (PR #240).

## Uso

1. Preencha o `.env` (modelo em `.env.example`):

    ```
    REPOSITORY_DB_HOST=
    REPOSITORY_DB_PORT=3050
    REPOSITORY_DB_DATABASE=
    REPOSITORY_DB_USER=
    REPOSITORY_DB_PASSWORD=
    ```

2. `bun install`
3. `bun run schema:generate`

A conexão é só leitura (transação `read committed read only`). Timeouts padrão: 10 s no attach e 60 s por query.

## Saída

Configurada em `seenc.firebird.config.ts`. Por padrão vai para `schema/`:

| Pasta | Conteúdo |
| --- | --- |
| `tables` | `create table` com PK, um arquivo por tabela |
| `views` | `create or alter view` |
| `domains`, `sequences`, `exceptions` | um arquivo por objeto |
| `uniques`, `checks`, `indexes`, `foreign-keys` | um arquivo por tabela |
| `triggers`, `procedures` | `create or alter`, um arquivo por objeto |

- Nome do arquivo = nome do objeto em maiúsculo.
- Pasta removida do `out` = tipo não gerado.
- `exclude` aceita padrões `LIKE` (`RDB$%`, `MON$%`).
- `.sql` que sobra na pasta de um objeto que não existe mais só é listado; `cleanStale: true` apaga.
- Erro em tabelas, views ou timeout interrompe tudo. Nos outros tipos, a falha fica só naquele tipo: os demais são gerados, o resumo no fim lista as falhas e o processo sai com código 1.

Não gera: grants, comentários, valor atual dos generators, UDFs e collations próprias. Não resolve a ordem de dependência entre objetos.

## Atualizar o weesu-sql

Gere contra a réplica de produção, copie `schema/*` sobre `packages/weesu-sql/DDL/firebird/` e revise o diff. Objeto que ainda não está na réplica entra à mão no mesmo formato.

## Driver

`@weesurepo/node-firebird` 1.1.11 está copiado em `vendor/node-firebird` (o mesmo da WMS API), então a instalação não precisa de token do GitHub Packages. As dependências de desenvolvimento do pacote foram retiradas do `package.json` copiado.
