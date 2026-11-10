# Entrar e criar conta com Google

Este piloto usa Google como acesso principal. O Google confirma a identidade, o Supabase valida a autorização e o servidor cria a sessão HttpOnly do Caixa Claro. Este fluxo não envia códigos por SMTP. Recuperação da Conta Google fica com o próprio Google.

O código está implementado e tem testes locais. **É necessário configurar o cliente OAuth nas contas Google Cloud e Supabase do proprietário para funcionar no site.** Não há credenciais desses painéis vinculadas a este executor.

## 1. Criar o cliente no Google Cloud

1. Entre em [Google Cloud Console](https://console.cloud.google.com/) com a conta que administrará o projeto.
2. Selecione ou crie um projeto, por exemplo, **Caixa Claro**.
3. Abra **Google Auth Platform**. Em interfaces antigas, a entrada pode aparecer em **APIs & Services → OAuth consent screen**.
4. Em **Branding**, informe o nome **Caixa Claro**, o e-mail de suporte e o contato do desenvolvedor. Siga os campos obrigatórios apresentados. Não solicite acesso ao Gmail ou à caixa de mensagens.
5. Em **Audience**, escolha **External**. Para o piloto, use o modo **Testing** e adicione em **Test users** cada conta Google que testará o aplicativo. Use contas que você controla antes de convidar outras pessoas.
6. Em **Clients → Create client**, escolha **Web application**. Dê um nome, como **Caixa Claro Web**.
7. Se pedir **Authorized JavaScript origins**, informe `https://peaceful-genie-fd5166.netlify.app`.
8. Em **Authorized redirect URIs**, cadastre exatamente:

```text
https://ppzlnrydbdxdkbytrwly.supabase.co/auth/v1/callback
```

9. Crie o cliente. O Google mostrará **Client ID** e **Client Secret**. Guarde o segredo em um gerenciador de senhas. O Client ID normalmente termina com `.apps.googleusercontent.com`.

Esse cliente OAuth é diferente da senha de app utilizada no SMTP. O segredo será colocado somente no provedor Google do Supabase. Não envie o Client Secret no chat, no GitHub ou no frontend.

O login básico solicita apenas identidade, e-mail e perfil. Ele não exige enviar e-mails nem habilitar a API do Gmail. Condições e limites dos planos Google/Supabase continuam aplicáveis. Para o teste, mantenha somente os usuários de teste necessários. Abrir para outras pessoas depois exige mudar o status da aplicação e cumprir eventuais exigências de publicação/verificação apresentadas pelo Google.

## 2. Habilitar Google no Supabase

1. No projeto Supabase `ppzlnrydbdxdkbytrwly`, abra **Authentication → Sign In / Providers → Google**.
2. Habilite o provedor.
3. Em **Client IDs**, cole o Client ID do cliente Web criado acima.
4. Em **Client Secret**, cole o segredo desse mesmo cliente.
5. Salve. Use o fluxo normal de verificação do provedor, sem desativar verificações de segurança para contornar erros.

Em **Authentication → URL Configuration**, configure:

**Site URL**:

```text
https://peaceful-genie-fd5166.netlify.app
```

**Redirect URLs** — adicione este endereço completo:

```text
https://peaceful-genie-fd5166.netlify.app/api/oauth/google/callback
```

Os endereços de retorno têm destinos diferentes:

| Onde cadastrar | Retorno |
| --- | --- |
| Cliente Web no Google Cloud | `https://ppzlnrydbdxdkbytrwly.supabase.co/auth/v1/callback` |
| Redirect URLs no Supabase | `https://peaceful-genie-fd5166.netlify.app/api/oauth/google/callback` |

Mantenha **Allow new users to sign up** habilitado para permitir novas contas. O Google verifica o endereço no fluxo OAuth; isso não exige ativar confirmação automática de contas por senha. A confirmação de e-mail dos fluxos antigos pode permanecer protegida.

## 3. Publicação e configurações do aplicativo

O aplicativo habilita o botão Google por padrão. **Não é necessário colocar Client ID ou Client Secret no Netlify.** Eles ficam no Supabase. As variáveis existentes de URL, chave pública, chave administrativa, origem e segredo da sessão continuam necessárias.

- `GOOGLE_AUTH_ENABLED`: padrão `true`. Use `false` somente para retirar o botão/endpoint de início do aplicativo.
- `EMAIL_CODES_ENABLED`: padrão `false`. Cadastro/recuperação por códigos ficam desativados. Entrar com uma senha já existente permanece disponível.
- `PUBLIC_AUTH_ENABLED` e `EMAIL_SETUP_CONFIRMED`: controlam os fluxos opcionais de e-mail quando `EMAIL_CODES_ENABLED=true`. Não são necessários para o acesso Google.
- `BACKUP_SETUP_CONFIRMED=true`: necessário para admitir uma primeira conta, juntamente com uma cópia externa recente. A rotina do GitHub deve continuar funcionando.

Google como provedor habilitado no aplicativo não comprova que o cliente externo já está configurado. Ao clicar, o servidor confere o provedor no Supabase e apresenta um erro específico se estiver ausente.

Configurações alteradas no Supabase/Google não exigem um novo build. Alterações nas variáveis de funções no Netlify exigem novo deploy. Se quiser reativar os códigos futuramente, configure e teste o SMTP e as opções correspondentes antes de mudar `EMAIL_CODES_ENABLED`.

## 4. Teste real antes do piloto

1. Aguarde o deploy e abra o site. Leia a política, marque a confirmação e clique em **Continuar com Google**.
2. Escolha o mesmo endereço de uma conta existente que possui dados. Use uma conta adicionada a **Test users**, enquanto o projeto Google estiver em Testing.
3. Confira caixa e DRE, saia, entre novamente e repita no celular. Confira o UUID em **Authentication → Users** antes/depois e os valores conhecidos. O aplicativo usa o UUID autenticado; não faz mesclagem por nome ou e-mail enviado no formulário.
4. O Supabase oferece associação automática de identidades em cenários de mesmo e-mail verificado. Confirme esse comportamento com as contas existentes no projeto real. **Não apague/recrie usuários para ligar o Google**, pois os documentos financeiros pertencem ao UUID original.
5. Teste uma segunda conta Google e confira que seus dados são separados e que ela não recebe a administração. Não copie registros de outra conta para contornar uma associação incorreta.
6. Cancele o consentimento no Google e confira que o site volta ao login com mensagem clara. Teste logout e uma nova entrada.

Os testes locais cobrem PKCE, cookie temporário Lax no retorno entre sites, sessão Strict/HttpOnly, autorização de uso único, callback forjado, prazo expirado, identidade não verificada, preservação dos registros/UUID/admin, novo usuário, dois aparelhos e isolamento. O provedor Google/Supabase Auth é simulado; o navegador e PostgreSQL/RLS são executados. O ensaio local não prova que o cliente OAuth foi instalado corretamente na conta do proprietário.

## Recuperação e limites

O usuário recupera sua Conta Google em [accounts.google.com/signin/recovery](https://accounts.google.com/signin/recovery). Perder acesso ao Google não autoriza o aplicativo a entregar documentos financeiros só porque alguém informou um nome ou e-mail. Sair do Caixa Claro encerra a sessão do aplicativo; a sessão da Conta Google no navegador é independente. Em aparelhos compartilhados, encerre também essa sessão Google. A sessão do aplicativo continua sendo revogada pelo logout e pode exigir nova autenticação ao expirar.

Backups financeiros permanecem necessários e não incluem as senhas/identidades da autenticação. A política identifica o uso do Google no acesso e deve refletir a operação real. O painel administrativo continua restrito à permissão explícita no banco.
