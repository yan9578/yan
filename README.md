# Caixa Claro

Fluxo de caixa como tela principal e DRE em uma área própria, com a mesma conta. Os lançamentos dos dois módulos continuam independentes. Esta versão acrescenta cadastro por e-mail, confirmação e recuperação por código, sessões protegidas, dados por usuário e administração privada.

O projeto contém a implementação e testes locais. **Esta alteração ainda não foi publicada no Netlify nem aplicada ao Supabase do proprietário.** Não houve envio de e-mail real: o proprietário informou que ainda não tem SMTP. Cadastro público permanece desativado na configuração de exemplo.

## Publicar a versão atual

Siga [docs/PUBLICACAO.md](docs/PUBLICACAO.md). Agora é necessário publicar o frontend **e as funções de servidor**, usando o repositório ou a ferramenta do Netlify. Enviar somente `dist` pela publicação manual não instala o servidor. Os instaladores estáticos anteriores foram desativados.

O mesmo projeto Netlify pode receber as próximas versões e conservar o endereço. Os dados ficam no Supabase e não são apagados pelo build do site. Não recrie contas nem tabelas para atualizar a interface.

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

- [Publicação e serviços externos](docs/PUBLICACAO.md)
- [Backup criptografado e restauração](docs/BACKUPS.md)
- [Testes, indicadores e limites da validação](docs/VALIDACAO.md)
- [O que foi entregue e o que falta configurar](docs/ENTREGA.md)

O servidor usa cookies HttpOnly e guarda tokens do provedor criptografados em tabelas privadas. Leituras e gravações financeiras usam a identidade do usuário e RLS do PostgreSQL. Ser administrador depende de uma permissão no banco, não do nome de usuário ou de metadados editáveis.

As migrações novas preservam os registros existentes. Rascunhos de gravações ainda não confirmadas podem ficar criptografados no aparelho por até sete dias; eles complementam o banco e não substituem o backup externo. Nunca apague `.data` para corrigir uma configuração.
