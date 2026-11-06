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

Neste ambiente não há credenciais administrativas vinculadas ao projeto, e o acesso de rede ao domínio Supabase do proprietário é bloqueado. Portanto, não foi possível aplicar migrações, verificar RLS remota, criar administradores remotos ou validar e-mails reais. Não há SMTP configurado informado pelo proprietário. Os workflows foram preparados, mas não executados na conta GitHub. Não foi realizado deploy no Netlify.

Não foi feito teste de carga nem auditoria de segurança independente. Os limites atuais de documentos são 5.000 registros de caixa e 50.000 lançamentos de DRE por conta, além de limites de tamanho e backup. Valide desempenho e custo antes de aumentar esses limites ou abrir o serviço em grande escala.
