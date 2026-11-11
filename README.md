# Caixa Claro

Fluxo de caixa como tela principal e DRE em uma área própria, com a mesma conta. Os lançamentos dos dois módulos continuam independentes. Esta versão oferece acesso com Google, sessões protegidas, dados por usuário e administração privada. Os fluxos de confirmação e recuperação por código permanecem opcionais.

O acesso principal do piloto agora é **Continuar com Google**, para entrar ou criar conta sem SMTP. O login por senha continua disponível para contas existentes. Novos pedidos de códigos por e-mail ficam desativados por padrão. A configuração externa e os testes do login Google estão em [docs/GOOGLE.md](docs/GOOGLE.md); o botão depende de um cliente OAuth configurado no Google Cloud e no Supabase.

O site anterior usava Netlify e Supabase. A conta Netlify apresentou suspensão; a migração para Vercel está preparada em [docs/VERCEL.md](docs/VERCEL.md). O deploy real na Vercel e os novos endereços de autenticação dependem da configuração da conta pelo proprietário. A alteração atual de acesso Google está implementada e testada localmente, mas sua validação no serviço real depende da configuração do cliente OAuth pelo proprietário. O SMTP apresentou falhas de autenticação no piloto; este acesso Google funciona sem enviar códigos pelo aplicativo. Os testes externos Google/Supabase Auth são simulados, enquanto APIs, navegador e PostgreSQL/RLS são executados.

## Publicar a versão atual

Para a hospedagem atual, siga [docs/VERCEL.md](docs/VERCEL.md). A Vercel importa `yan9578/yan`, branch `main`, executa o build em `dist` e publica a função de servidor automaticamente. O fluxo anterior do Netlify permanece documentado em [docs/PUBLICACAO.md](docs/PUBLICACAO.md). Enviar somente arquivos estáticos não instala a API.

O mesmo projeto Vercel pode receber as próximas versões e conservar seu domínio de produção. Os dados ficam no Supabase e não são apagados pelo build do site. Não recrie contas nem tabelas para atualizar a interface.

## Desenvolvimento

Use Node.js 24 LTS. Instale as ferramentas de teste com `npm ci`. A aplicação não tem dependências de execução externas ao Node.

Para testar com um projeto Supabase separado, preencha uma cópia local de [.env.example](.env.example), aplique as migrações e execute:

```sh
node --env-file=.env server.js
```

Abra o endereço exato de `APP_ORIGIN`, normalmente `http://127.0.0.1:3000`. Não compartilhe `.env`, chaves privadas, `.data` ou backups. O fluxo de código por e-mail precisa de SMTP real também nesse modo.

Sem `SUPABASE_URL`, `npm start` mantém o servidor SQLite **privado legado**, para preservar os testes e dados anteriores em `.data/caixa.sqlite`. Esse modo não tem cadastro público, administração ou recuperação por e-mail. Não é a versão pública. As contas locais não são copiadas automaticamente ao Supabase.

## Verificar

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Os testes usam dados sintéticos. O PostgreSQL é executado com PGlite; o transporte de Supabase Auth e e-mail é simulado. O teste de navegador usa HTTP, as APIs do aplicativo, SQL e políticas reais de isolamento. A integração com o projeto Supabase e a entrega de e-mails precisam da validação externa descrita em [docs/VALIDACAO.md](docs/VALIDACAO.md).

## Operação e recuperação

- [Publicação na Vercel e mudança de domínio](docs/VERCEL.md)
- [Publicação anterior no Netlify e serviços externos](docs/PUBLICACAO.md)
- [Backup criptografado e restauração](docs/BACKUPS.md)
- [Testes, indicadores e limites da validação](docs/VALIDACAO.md)
- [O que foi entregue e o que falta configurar](docs/ENTREGA.md)

O servidor usa cookies HttpOnly e guarda tokens do provedor criptografados em tabelas privadas. Leituras e gravações financeiras usam a identidade do usuário e RLS do PostgreSQL. Ser administrador depende de uma permissão no banco, não do nome de usuário ou de metadados editáveis.

As migrações novas preservam os registros existentes. Rascunhos de gravações ainda não confirmadas podem ficar criptografados no aparelho por até sete dias; eles complementam o banco e não substituem o backup externo. Nunca apague `.data` para corrigir uma configuração.
