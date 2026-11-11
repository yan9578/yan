# Publicar o Caixa Claro

> A migração atual para Vercel está em [VERCEL.md](VERCEL.md). As instruções Netlify abaixo permanecem como referência da hospedagem anterior.

O código foi preparado para o site atual em `https://peaceful-genie-fd5166.netlify.app`, com Supabase para contas e dados. As etapas abaixo ainda precisam ser feitas nas contas do proprietário. Publicar ou salvar um ambiente Codex não executa estas etapas.

**Acesso atual do piloto:** siga primeiro [GOOGLE.md](GOOGLE.md) para configurar **Continuar com Google**. Esse acesso não depende de SMTP. Os passos de e-mail abaixo são opcionais, para reativar cadastro/recuperação por códigos com `EMAIL_CODES_ENABLED=true`; ficam desativados por padrão. Os requisitos de banco, sessões, backup e publicação com funções continuam necessários.

## 1. Preservar os dados atuais

Antes das migrações, exporte as tabelas `cashbooks` e `dre_books` no painel do Supabase ou use o backup PostgreSQL disponível na sua operação. Guarde as cópias em local privado. A exportação das tabelas financeiras não é uma cópia completa da autenticação. Preserve também o banco local `.data`, caso ainda o utilize.

Para ensaiar mudanças com dados sintéticos, use um projeto Supabase separado. Uma deploy preview do Netlify conectada ao banco de produção continua alterando dados de produção.

## 2. Atualizar o banco no Supabase

Abra o projeto certo e seu **SQL Editor**. O conteúdo dos arquivos SQL deve ser executado ali, não no terminal Linux. Ordem:

1. [schema.sql](../cloud/schema.sql), caso ainda não tenha sido aplicado.
2. [002-dre.sql](../cloud/002-dre.sql), caso ainda não tenha sido aplicado.
3. [003-public-platform.sql](../cloud/003-public-platform.sql).
4. [005-data-validation-backups.sql](../cloud/005-data-validation-backups.sql).

Confira as permissões de `cashbooks` e `dre_books`: RLS ativa, usuário autenticado limitado ao próprio `user_id`, acesso anônimo negado. O schema `private` não deve estar na lista de schemas expostos pela Data API. Os registros anteriores não são importados, apagados nem vinculados a uma conta diferente por esses scripts.

Confira em Authentication se `yansiqueirapedro@gmail.com` é realmente a conta confirmada do proprietário. Só então execute [004-admin-owner.sql](../cloud/004-admin-owner.sql). A permissão depende do UUID dessa conta no banco; chamar-se Yan ou mudar metadados não concede administração. Para revogar a permissão, remova exclusivamente a linha correspondente em `private.app_admins` pelo administrador do banco.

## 3. Configurar e-mail e proteção contra automação

O SMTP do Gmail foi tentado no piloto e retornou erro de autenticação `535`. Para reativar códigos por e-mail, será necessário corrigir e validar o SMTP. É necessário contratar ou criar uma conta em um provedor de e-mail transacional, verificar o remetente e preencher **Authentication → Email/SMTP** no Supabase. Um domínio de envio pode gerar custo; condições gratuitas, limites e exigências variam por provedor. O remetente padrão do Supabase não deve ser usado como solução de envio público.

No Supabase:

- Ative o provedor e-mail e a confirmação de e-mail. Desative confirmação automática.
- Nos templates **Confirm signup** e **Reset password**, use o código `{{ .Token }}` no corpo da mensagem, com orientação para digitá-lo no aplicativo. O aplicativo não depende de clicar em um link de confirmação. Não insira `service_role` nos templates.
- Configure a expiração do código de e-mail para **600 segundos**. O servidor também limita o desafio a dez minutos e a autorização de troca de senha a cinco minutos.
- Configure a política de novas senhas com pelo menos dez caracteres, letras e números; ajuste a mesma política no servidor caso a regra do provedor seja alterada. Senhas antigas de contas existentes não são trocadas por esta publicação.
- Configure os limites nativos de autenticação e envio no Supabase e no provedor SMTP. Eles complementam os limites persistentes do aplicativo. Mantenha a rotação de refresh tokens e a janela de reutilização concorrente do provedor.
- Cadastre a URL HTTPS final como Site URL. Use somente URLs de redirecionamento necessárias à sua operação.

Crie um widget **Cloudflare Turnstile** para o domínio do site. Coloque a chave pública em `TURNSTILE_SITE_KEY` no Netlify e a chave secreta **nas configurações de CAPTCHA do Supabase**. O servidor encaminha o token ao Supabase; a mesma verificação não é consumida duas vezes. Em um domínio de testes separado, configure um widget próprio. Não use chaves de teste na publicação pública.

Senhas SMTP e chaves privadas devem ser inseridas nos painéis dos serviços. **Não envie esses valores no chat.**

## 4. Preparar as variáveis do servidor no Netlify

Use as variáveis de ambiente do **mesmo projeto Netlify**, com disponibilidade para as funções. Não publique `.env`. Em deploy previews, use os valores do projeto de teste; não habilite cadastros reais durante a preparação.

| Variável | Valor/uso |
| --- | --- |
| `NODE_ENV` | `production` |
| `APP_ORIGIN` | `https://peaceful-genie-fd5166.netlify.app`, sem barra final |
| `SUPABASE_URL` | URL HTTPS do projeto Supabase correto |
| `SUPABASE_PUBLISHABLE_KEY` | Chave Publishable do projeto |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave administrativa `sb_secret_…` ou `service_role`; somente funções |
| `SESSION_SECRET` | Segredo aleatório, gerado localmente com `node scripts/generate-secret.mjs` |
| `PUBLIC_AUTH_ENABLED` | `false` durante a preparação |
| `EMAIL_SETUP_CONFIRMED` | `false` até concluir o teste real de e-mail |
| `BACKUP_SETUP_CONFIRMED` | `false` até verificar cópia externa e restauração |
| `TURNSTILE_SITE_KEY` | Chave pública do widget do domínio |
| `PRIVACY_CONTROLLER` | Nome real do responsável pelo tratamento |
| `PRIVACY_CONTACT_EMAIL` | Endereço real para suporte e direitos sobre dados |

O proprietário informou Yan como responsável e yansiqueirapedro@gmail.com como contato público. Esses valores são os padrões deste piloto e podem ser substituídos pelas variáveis acima. A política deve ser revisada conforme o responsável, região escolhida, fornecedores e retenções efetivas. O texto preparado não equivale a uma certificação de conformidade com a LGPD.

Guarde `SESSION_SECRET` em um gerenciador de segredos. Trocá-lo invalida os tokens criptografados e a chave dos rascunhos locais existentes; planeje a troca e exporte pendências antes. Não use a mesma chave para backups.

Variáveis opcionais:

- `DATABASE_LIMIT_MB`: limite real de armazenamento do plano, em MB. Sem valor, o painel mostra “Não configurado”.
- `NETLIFY_API_TOKEN` e `NETLIFY_ACCOUNT_SLUG`: credencial de servidor e identificador da equipe para consultar minutos de build. O número cobre a equipe, não apenas este site. O token nunca é enviado ao navegador.
- `NETLIFY_DASHBOARD_URL`: link do projeto no painel, para consultar funções, tráfego, créditos e outros limites que não são fornecidos por essa consulta.
- `YAN_AUTH_EMAIL` e `YAN1_AUTH_EMAIL`: opcionais, para alterar os apelidos antigos. Por padrão, Yan e Yan1 continuam apontando para os e-mails já informados; as senhas são as das respectivas contas no Supabase.

## 5. Publicar o projeto com as funções

Envie o código atual a um repositório privado de sua conta, sem `.env`, `.data`, `node_modules` ou backups. No projeto existente do Netlify, conecte esse repositório. O arquivo [netlify.toml](../netlify.toml) define:

- Node.js 24;
- build `npm run build`;
- arquivos públicos em `dist`;
- funções em `netlify/functions`;
- rota `/api/*` encaminhada à função.

Revise o deploy antes de torná-lo a versão principal. Alternativamente, a ferramenta oficial Netlify CLI pode publicar o projeto completo com build e funções, após login e vínculo ao mesmo projeto. **Arrastar apenas `dist` na publicação manual não ativa esta versão.** Não use os comandos estáticos antigos do chat.

Depois do deploy, abra `/api/config` no endereço do site: deve retornar JSON com `serverMode: true`, sem chaves privadas. Sem configuração completa a função retorna `SERVER_NOT_CONFIGURED`, em vez de simular login. Confira que as funções foram incluídas no deploy e que os logs não contêm credenciais. Alterações futuras seguem esse fluxo no mesmo projeto; não é preciso recriar o banco ou as contas.

## 6. Ativar cópias externas

Siga [BACKUPS.md](BACKUPS.md). Cadastros novos exigem uma cópia externa confirmada nas últimas 48 horas. Marcar apenas a variável de ambiente não fabrica esse registro. Falta de backup recente bloqueia novos cadastros e aparece no painel; login e recuperação de contas existentes continuam disponíveis se estiverem configurados.

## 7. Validar com e-mails e aparelhos reais

Após configurar SMTP, backup e privacidade, habilite em um ambiente de testes `EMAIL_CODES_ENABLED=true` e os três valores: `PUBLIC_AUTH_ENABLED=true`, `EMAIL_SETUP_CONFIRMED=true` e `BACKUP_SETUP_CONFIRMED=true`. Confirme também que o Supabase permite novos cadastros e exige confirmação de e-mail. Use contas e dados sintéticos para os testes de [VALIDACAO.md](VALIDACAO.md).

O código local já foi testado, mas isso não confirma a entrega do provedor SMTP, as políticas instaladas no seu Supabase ou o funcionamento do deploy real. Faça esses testes antes de convidar usuários para registrar dados financeiros.

## 8. Abrir o piloto e acompanhar limites

Depois da validação real, aplique a mesma configuração conferida ao projeto principal. Comece convidando poucas pessoas e acompanhe salvamentos, erros, cópias externas e consumo. Revise a política com os dados reais do responsável antes de abrir o cadastro.

Os planos gratuitos de hospedagem, banco, envio e armazenamento têm franquias e condições que podem mudar. Configure alertas de uso e limites de gasto nos painéis. Não há garantia de gratuidade contínua. Para crescer, primeiro acompanhe armazenamento e número de requisições; as tabelas por conta podem permanecer no mesmo PostgreSQL ao mudar de plano. Um volume financeiro superior ao limite do backup lógico exige uma rotina transacional apropriada, conforme BACKUPS.md.

Para fechar temporariamente o cadastro, use `PUBLIC_AUTH_ENABLED=false`. Para reverter um deploy, escolha a versão anterior no Netlify, preservando o banco. As migrações são aditivas; não apague tabelas para fazer rollback. Versões muito antigas podem exigir uma nova entrada na conta e não recebem as proteções do servidor atual.

Se uma exclusão administrativa for interrompida durante o processamento, aguarde cinco minutos e tente a mesma solicitação novamente. A operação usa a conta/UUID já associado à solicitação; não escolha outra conta para contornar um erro.
