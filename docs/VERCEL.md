# Migrar o Caixa Claro para a Vercel

A hospedagem muda; o projeto Supabase, seus usuários/UUIDs, permissões, caixa e DRE permanecem no mesmo banco. Nenhuma migração SQL nova é necessária. O backup do GitHub continua independente da hospedagem. O Netlify informou suspensão da conta, mas a causa não foi confirmada pelo suporte; o aviso anterior de 75% de créditos não prova a causa.

O código tem `vercel.json`, função Node.js 24 em `api/router.mjs` e frontend em `dist`. O build continua `npm run build`. A função mantém autenticação, RLS, sessões HttpOnly/Secure e retorno Google PKCE no servidor. Somente arquivos públicos entram em `dist`; segredos são variáveis da função.

## 1. Importar o repositório

1. Entre em [vercel.com](https://vercel.com/) com GitHub. Confira as condições atuais: o plano Hobby se destina a uso pessoal e não comercial. Um piloto pessoal e uma operação comercial têm requisitos de plano diferentes; não presuma gratuidade ilimitada ao disponibilizar para empresas/clientes.
2. Clique em **Add New → Project** (ou **New Project**).
3. Importe **yan9578/yan** e autorize o acesso a esse repositório quando solicitado. Não crie outro repositório vazio.
4. A branch de produção deve ser **main**. Root Directory: raiz do repositório. Framework Preset: **Other**. Node.js: **24.x**.
5. A configuração do repositório define Install Command `npm ci`, Build Command `npm run build`, Output Directory `dist` e a função de API. Mantenha esses valores.
6. Escolha um nome de projeto disponível e clique em **Deploy**. Copie o domínio estável de produção mostrado em **Domains/Visit**. Não use o link temporário de um deploy nem um endereço de Preview para configurar o login.

Esse primeiro deploy pode mostrar a interface com o serviço ainda não configurado. Serve para obter o domínio real; a próxima etapa configura o servidor. Não convide usuários antes da validação completa.

## 2. Variáveis de produção

Abra **Project → Settings → Environment Variables**. Cadastre para **Production**, somente dentro da Vercel. Use chaves do mesmo Supabase que já contém os dados. Não envie valores privados no chat, Git ou frontend.

| Nome | Valor |
| --- | --- |
| `APP_ORIGIN` | URL estável da Vercel, com `https://`, sem caminho ou barra no final |
| `SUPABASE_URL` | `https://ppzlnrydbdxdkbytrwly.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | Publishable key do projeto Supabase (ou anon legada correta) |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave administrativa do projeto, somente no servidor; marque Sensitive se disponível |
| `SESSION_SECRET` | Segredo de sessão com pelo menos 32 caracteres; marque Sensitive se disponível |
| `GOOGLE_AUTH_ENABLED` | `true` |
| `EMAIL_CODES_ENABLED` | `false` |
| `PUBLIC_AUTH_ENABLED` | `false` |
| `EMAIL_SETUP_CONFIRMED` | `false`, pois o fluxo Google não usa SMTP |
| `BACKUP_SETUP_CONFIRMED` | `true` somente se a rotina de backup do GitHub está configurada e verificada |
| `TURNSTILE_SITE_KEY` | Mesma chave pública da Cloudflare, necessária para o login por senha protegido |
| `PRIVACY_CONTROLLER` | `Yan` |
| `PRIVACY_CONTACT_EMAIL` | `yansiqueirapedro@gmail.com` |

`VERCEL=1` é fornecida pela plataforma e força cookies Secure e exigência de HTTPS. O Node de produção é definido no pacote/configuração da plataforma. Não reutilize chaves de um Supabase vazio nem copie variáveis `NETLIFY_*`. Client ID/Secret do Google ficam no Supabase. A chave de criptografia do backup permanece no ambiente `backups` do GitHub; não precisa ser colocada na Vercel.

Se não conseguir recuperar o segredo da sessão antigo, gere outro com um gerenciador de senhas (ao menos 32 caracteres aleatórios) ou localmente com `node scripts/generate-secret.mjs`. Trocar esse segredo invalida a leitura das sessões anteriores; não apaga usuários nem documentos financeiros. Preserve a chave de backup existente.

Depois de salvar todas as variáveis, abra **Deployments → último deploy → ⋯ → Redeploy**. Variáveis alteradas não atualizam um deploy antigo. Nunca habilite produção por inteiro em Previews com domínios diferentes para contornar proteção de origem.

## 3. Atualizar os endereços do login

Substitua `https://SEU-DOMINIO.vercel.app` abaixo pelo domínio de produção real, exatamente igual a `APP_ORIGIN`.

**Supabase → Authentication → URL Configuration**:

- Site URL: `https://SEU-DOMINIO.vercel.app`
- Redirect URLs: adicione `https://SEU-DOMINIO.vercel.app/api/oauth/google/callback`.

**Google Cloud → Google Auth Platform → Clients → seu cliente Web**:

- Authorized JavaScript origins: adicione `https://SEU-DOMINIO.vercel.app`, sem barra final ou caminho.
- Authorized redirect URIs: o retorno continua `https://ppzlnrydbdxdkbytrwly.supabase.co/auth/v1/callback`. Esse endereço aponta para o Supabase e não muda com a hospedagem.
- Supabase → Sign In / Providers → Google: mantenha o Client ID completo terminado em `.apps.googleusercontent.com` e o Client Secret do mesmo cliente. Use as instruções de [GOOGLE.md](GOOGLE.md). Se o Google está em Testing, adicione os endereços de teste em Audience → Test users.

**Cloudflare → Turnstile → seu widget → Hostname Management**:

- Adicione apenas o hostname novo, por exemplo `SEU-DOMINIO.vercel.app`, sem `https://` ou caminho. O widget e o segredo no Supabase continuam correspondentes. Isso preserva o login por senha; Google não usa esse CAPTCHA no aplicativo.

## 4. Validar antes de liberar

1. Abra a URL de produção e `/api/config`. Deve aparecer JSON com `serverMode:true`, `googleAuth:true`, `publicAuth:false`. Não deve aparecer `SERVER_NOT_CONFIGURED`. O nome da variável no diagnóstico indica o campo a corrigir, sem expor seu valor.
2. Use **Continuar com Google** com o mesmo e-mail da conta antiga. Confira o mesmo UUID em Supabase → Authentication → Users e os valores conhecidos de caixa e DRE. Não apague nem recrie usuários. A associação automática de identidades de e-mail verificado precisa ser validada no Supabase real.
3. Teste logout, novo login e a mesma conta no celular. A mudança de domínio exige nova autenticação. Rascunhos/armazenamento local pendentes no domínio antigo não são transferidos automaticamente; confira dados efetivamente salvos no Supabase.
4. Teste outra conta Google: ela deve começar com seus próprios dados e não ter administração. Novas contas exigem um backup externo confirmado nas últimas 48 horas. Confira a rotina do GitHub se houver bloqueio de cadastro.
5. Teste o login por senha existente e o CAPTCHA no domínio novo. A recuperação principal deste piloto é pela Conta Google, sem envio de código pelo aplicativo.
6. Consulte **Vercel → Usage**. A API administrativa informa o provedor e oferece o painel, mas não consulta nem calcula créditos da Vercel automaticamente.

Não houve publicação remota da Vercel por este executor: não há conta ou credenciais da Vercel vinculadas à sessão. Os testes locais executam a função Node, o rewrite de teste, APIs e PostgreSQL/RLS. O navegador testa Google com provedor Auth simulado; o roteamento real, as variáveis e as credenciais OAuth só ficam confirmados após os testes acima no deploy do proprietário.
