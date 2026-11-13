# Caixa Claro

Fluxo de caixa como tela principal e DRE em uma área própria, com a mesma conta. Ambos usam o mesmo cadastro de empresas; os lançamentos e cálculos de caixa e DRE continuam independentes.

A interface pública oferece somente **Continuar com Google** para entrar ou criar conta. O proprietário confirmou o acesso Google no site real. Os formulários de e-mail/senha estão ocultos por padrão; a implementação e as credenciais antigas foram preservadas. A opção de manutenção `PASSWORD_LOGIN_VISIBLE=true` permite voltar a exibi-los futuramente, após validar o CAPTCHA e as demais configurações necessárias.

O Fluxo de Caixa permite selecionar, cadastrar e editar empresas do mesmo cadastro da DRE. Totais, histórico, gráficos, busca e CSV exibem somente a empresa selecionada. Lançamentos anteriores sem empresa ficam em **Sem empresa definida**, aguardando vinculação explícita. Veja [docs/EMPRESAS.md](docs/EMPRESAS.md).

O site usa Vercel e Supabase em `https://yan-khaki-two.vercel.app`. A publicação está em [docs/VERCEL.md](docs/VERCEL.md); configurações do provedor Google estão em [docs/GOOGLE.md](docs/GOOGLE.md). Os testes locais usam Auth simulado, com APIs, navegador e PostgreSQL/RLS executados. Não acessam os dados financeiros reais do proprietário.

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
