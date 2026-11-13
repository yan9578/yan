# Validação da versão pública

Os testes abaixo foram executados localmente com dados sintéticos. Não acessaram dados financeiros reais do proprietário e não publicaram alterações nos serviços externos.

## Testes automatizados

Requisitos: Node.js 24, `npm ci` e Chromium do Playwright ou `BROWSER_PATH` apontando para um Chromium instalado.

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Os testes de integração executam PostgreSQL com PGlite, migrações SQL, funções e RLS. O transporte de Supabase Auth/SMTP é um adaptador de teste com identidades sintéticas, códigos temporários e uso único. O servidor de aplicação e o navegador são executados de verdade. Isso testa a lógica implementada sem alegar entrega real de mensagens ou configuração do Supabase hospedado.

Cobertura:

- Cadastro, confirmação por código, código incorreto/expirado/reutilizado e recuperação de senha.
- Troca de senha de uso único, revogação de sessões, login, logout e renovação concorrente.
- Cookie HttpOnly, SameSite e Secure em produção; ausência de JWT/chave administrativa no cliente.
- Rate limits persistentes e atômicos; rejeição de requisições de outra origem e mensagens que não revelam a existência de uma conta.
- Isolamento entre dois UUIDs, manipulação do proprietário da requisição, privilégios de funções privadas e administração autorizada pelo banco.
- Dados do caixa e da DRE preservados entre requisições, instâncias do servidor e contextos de navegador distintos.
- Validação de dados na API e no SQL, revisão concorrente, rascunhos criptografados após falha, confirmação somente depois da resposta e recuperação de pendências.
- Painel administrativo, contagens a partir de dados conhecidos, filtros, solicitação de exclusão e execução administrativa com confirmação de retenção.
- Desktop e celular, navegação entre caixa/DRE, conteúdo de lançamento sem executar HTML e ausência de rolagem horizontal nas telas verificadas.
- Backup financeiro criptografado, rejeição de chave errada/adulteração, simulação, cópia prévia, restauração de valores, atualização de revisões e manutenção preservada após falha.
- Build público por lista permitida, sem inclusão de segredos e sem publicação dos arquivos privados.

## Teste no serviço real antes de convidar usuários

Depois de concluir PUBLICACAO.md, use dados fictícios e endereços de e-mail que você controla:

1. Cadastre A. Confira que nenhum dado financeiro abre antes da confirmação. Receba e digite o código; teste também um código errado e um código vencido. Confira spam e o remetente.
2. Entre, registre uma entrada e uma saída, e espere a indicação de salvamento. Cadastre uma empresa e um lançamento na DRE. Saia e entre novamente.
3. Em outro computador ou celular, entre como A: os mesmos valores devem aparecer. Na conta B, eles não devem aparecer. Tente acessar Administração com B: o servidor deve recusar.
4. Com ferramentas de desenvolvedor, tente ler/gravar uma linha de A usando a identidade de B diretamente na Data API do Supabase: RLS deve recusar. Tente executar funções de infraestrutura com a chave pública: deve ser negado. Não use chaves administrativas nesses testes de usuário.
5. Solicite recuperação de A e receba o código real. Troque a senha, confira que a anterior falha e que outras sessões da aplicação precisam entrar novamente. O mesmo código/autorização não pode ser reutilizado.
6. Teste “Manter conectado” após fechar e reabrir o navegador; teste logout e reenvio de código com CAPTCHA real. Confirme os limites nativos do Supabase e do SMTP.
7. Interrompa a conexão durante uma gravação. Deve aparecer “pendente”, sem sucesso falso. Reconecte, abra Minha conta e confira o rascunho e o valor no servidor antes de descartá-lo.
8. Acesse Administração com o proprietário autorizado. Compare contas e confirmações com Authentication no Supabase e confira datas, erros e salvamentos. Consulte a data do último backup externo e os limites nos painéis dos provedores.
9. Com B fictício, exporte os dados, solicite exclusão e processe-a como administrador depois de conferir retenção. Confira que B não entra mais e que A continua intacto.
10. Baixe uma cópia externa e realize uma restauração em ambiente separado. Confira os dois módulos, UUIDs e revisões. Um teste apenas de criação ou de descriptografia não substitui a restauração.

## Como interpretar os indicadores

- Datas dos indicadores: fuso `America/Sao_Paulo`. Cadastros: hoje, últimos sete e últimos trinta dias, em janelas móveis, incluindo o dia atual.
- Ativo: conta com atividade autenticada observada no dia. Ativos mensais: contas distintas nos últimos trinta dias. Retorno: atividade em pelo menos dois dias no período selecionado; recarregar uma página no mesmo dia não conta como retorno.
- Visita opcional: uma abertura da página que autorizou estatísticas; visitantes aproximados: identificadores aleatórios distintos, por navegador. Bloqueios, recusa, troca de aparelho ou limpeza de cookies alteram esses números. Não representam pessoas identificadas com exatidão.
- Uso de funcionalidade inclui operações autenticadas essenciais e eventos opcionais autorizados; é uma medida de operações observadas, não de tempo passado em uma tela. O painel não contém valores ou descrições financeiras dos usuários.
- Falhas incluem erros observados no servidor e falhas de conexão que o navegador conseguiu reportar. Uma interrupção sem retorno de conexão pode não ser reportada; os totais não são auditoria completa de incidentes.
- Banco completo inclui índices e estruturas internas. A franquia deve ser informada conforme o plano real. A integração opcional Netlify mostra minutos de build da equipe; funções, tráfego, créditos e outros recursos devem ser acompanhados também no painel do Netlify.

## Limites e pendências reais

Neste ambiente não há credenciais administrativas vinculadas ao projeto, e o acesso de rede ao domínio Supabase do proprietário é bloqueado. Portanto, não foi possível aplicar migrações, verificar RLS remota, criar administradores remotos ou validar e-mails reais. O proprietário configurou Netlify, banco e backup durante o piloto e apresentou erros de autenticação SMTP. O novo acesso Google ainda precisa de cliente OAuth configurado e validação no serviço real.

Não foi feito teste de carga nem auditoria de segurança independente. Os limites atuais de documentos são 5.000 registros de caixa e 50.000 lançamentos de DRE por conta, além de limites de tamanho e backup. Valide desempenho e custo antes de aumentar esses limites ou abrir o serviço em grande escala.

## Regressão do CAPTCHA

Foi reproduzido o caso em que uma interação humana concluída depois de 45 segundos era descartada pelo prazo antigo de 30 segundos. O fluxo atual usa o modo oficial `execution: execute`: só inicia o CAPTCHA quando o usuário envia um formulário válido, aguarda a conclusão e encaminha o token uma única vez ao Supabase. A verificação pode durar até dois minutos, além do limite de carregamento do SDK. Preencher o formulário antes do envio não consome o prazo do token.

O teste de navegador simula um SDK com `render`, `execute` e `remove`, uma pessoa que leva 45 segundos, falha de script, erro do widget, callback antigo, nova tentativa, dois cadastros consecutivos e recuperação após senha incorreta. O adaptador Auth do teste recusa tokens desconhecidos ou reutilizados. Também verifica que uma falha ao enviar o e-mail não apresenta sucesso nem inicia outra verificação automaticamente. O PostgreSQL e as APIs do aplicativo são executados; Cloudflare e Auth/e-mail são simulados.

O SDK real da Cloudflare, as chaves instaladas no Supabase e o envio real pelo SMTP continuam exigindo conferência no site publicado. A rede deste executor bloqueia os domínios do site e da Cloudflare. Erros conhecidos de envio de e-mail e gravação no Auth agora recebem códigos de suporte separados, sem copiar mensagens privadas do provedor para a resposta.

## Acesso Google

O acesso principal agora usa OAuth PKCE, conforme [GOOGLE.md](GOOGLE.md). Foram aprovados 38 testes automatizados e os testes de navegador de acesso Google, códigos opcionais e CAPTCHA. A cobertura inclui retorno entre origens com cookie Lax, sessão Strict, autorização de uso único, CSRF, cookie trocado, PKCE incompatível, expiração, e-mail não confirmado, provedor diferente, preservação de UUID/dados/admin, dois aparelhos e nova conta isolada. Nenhum código de e-mail é enviado no fluxo Google. A instalação do cliente Google e o login no projeto real ainda dependem das configurações externas do proprietário.

## Migração Vercel

O adaptador Node da Vercel foi executado com HTTP local, rewrite emulado a partir de `vercel.json`, PostgreSQL/RLS reais e Auth simulado. Cobertura: corpo JSON bruto e limites de tamanho, consulta com parâmetros, cookies separados, retorno 303 do OAuth, IP de plataforma, rejeição de rota ambígua/CSRF, autenticação e administração no mesmo banco. O teste de navegador Google foi repetido usando esse adaptador para conta antiga, DRE/caixa, conta nova isolada, cancelamento e dois aparelhos. A Vercel real ainda depende de importação do repositório, variáveis, domínio e conferência descritos em [VERCEL.md](VERCEL.md). Nenhuma conta Vercel está vinculada ao executor; não foi feito deploy remoto.

## Caixa por empresa e Google exclusivo na interface

Foi executado `scripts/test-cash-companies-browser.mjs` com o adaptador Vercel e PostgreSQL/RLS reais. O teste preserva um lançamento antigo sem atribuição, reaproveita duas empresas da DRE e cadastra outra pelo caixa sem modificar as entradas de DRE. Reproduz A com R$ 50.000/35.000 e B com R$ 80.000/60.000, verificando os saldos individuais de R$ 15.000 e R$ 20.000. Cobre CSV sem dados de outra empresa, escolha explícita de empresa no lançamento, edição, exclusão/desfazer, exemplos sem substituir outros caixas, renomeação, novo cadastro feito pela DRE, demonstração separada, vinculação confirmada do legado, logout e dois aparelhos.

Conflitos de revisão de caixa e de cadastro compartilhado são provocados entre duas janelas. O formulário permanece aberto e os dados concorrentes são preservados antes da nova tentativa. Outra conta com empresa de mesmo nome recebe IDs e registros próprios. Remover um cadastro na DRE preserva os registros do caixa. Também foram verificados o layout móvel e a ausência de carregamento do CAPTCHA ou exibição de formulários de e-mail/senha na configuração pública padrão.

Backups criptografados são restaurados em SQL com `company`/`companyName` preservados. Cópias anteriores sem esses campos continuam válidas. O limite de 5.000 lançamentos de caixa por conta e o controle de revisão existentes permanecem. Não há nova migração SQL para essa extensão dos registros JSON. O OAuth externo dos testes continua simulado; a autenticação Google real já havia sido confirmada pelo proprietário.
