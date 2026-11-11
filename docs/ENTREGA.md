# Entrega atual: Vercel e acesso com Google

O piloto passa a oferecer **Continuar com Google** para entrar ou criar conta sem SMTP. A senha do Google fica com o Google, e a recuperação desse acesso usa a Conta Google. O login por senha do aplicativo permanece para contas existentes. Novos pedidos de código de e-mail ficam desativados por padrão.

## Implementado

- Migração de hospedagem preparada em [VERCEL.md](VERCEL.md), com função Node.js 24, rewrite da API e cabeçalhos de segurança. O Supabase e os UUIDs existentes são mantidos.

- Autorização Google pelo Supabase com PKCE S256, segredo de verificação em cookie criptografado HttpOnly e autorização de uso único no banco.
- Cookie temporário Lax somente no retorno do provedor; sessão do aplicativo continua Strict, HttpOnly e Secure em produção.
- Identidade verificada no servidor. Dados usam exclusivamente o UUID validado pelo Supabase; o aplicativo não mescla contas por e-mail recebido do navegador.
- Confirmação da política, manter conectado, cancelamento e mensagens para prazo expirado, provedor ausente e cadastro temporariamente indisponível.
- Fluxo de caixa, DRE, administração, isolamento, rascunhos e rotinas de backup preservados.
- Nenhuma migração SQL nova é necessária para esse fluxo, desde que as migrações anteriores já estejam aplicadas.

## Validação realizada

`npm test`: **34 testes aprovados**. Build concluído. Testes de navegador cobrem o retorno entre origens, preservação de UUID/dados/admin de conta existente, conta nova isolada, outro aparelho, cancelamento e retorno sem cookie. Os testes de códigos/CAPTCHA existentes também passaram. O navegador Google passou também pelo adaptador Vercel, incluindo query do callback, cookies separados, dados existentes e nova conta isolada. O rewrite é emulado localmente; o deploy remoto ainda precisa ser validado.

Google/Supabase Auth são simulados nos testes. O PostgreSQL/RLS e as APIs do aplicativo são executados. Não houve login real no Google Cloud do proprietário nem instalação de credenciais OAuth por este executor.

## Configuração externa necessária

O domínio publicado pelo proprietário é `https://yan-khaki-two.vercel.app`. A função inclui padrões públicos para esse endereço; chaves do Supabase e `SESSION_SECRET` continuam obrigatórias nas variáveis privadas da Vercel. Os retornos exatos estão em [VERCEL.md](VERCEL.md).

Siga primeiro [VERCEL.md](VERCEL.md) para importar o repositório, configurar variáveis e o domínio de produção. Depois [GOOGLE.md](GOOGLE.md): criar cliente OAuth Web no Google Cloud, adicionar os usuários de teste, habilitar Google no Supabase e configurar os dois endereços de retorno corretos. Client Secret fica somente no Supabase; não vai no chat, GitHub ou frontend.

Antes de convidar usuários, faça um login real com a conta antiga e confira o mesmo UUID, os valores de caixa/DRE e o acesso em outro aparelho. Depois teste uma conta nova e confirme o isolamento. A associação automática de identidades de mesmo e-mail verificado depende do comportamento do Supabase real; não apague contas para ligá-las ao Google.

A cópia financeira criptografada continua necessária e não substitui backup completo de Supabase Auth/PostgreSQL. Configurações de serviços e limites dos planos precisam ser acompanhados pelo proprietário.
