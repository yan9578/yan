# Entrega e configuração pendente

## Implementado no projeto

| Área | Resultado |
| --- | --- |
| Contas | Cadastro com confirmação, recuperação por código, login, logout e manter conectado |
| Sessões | Cookies HttpOnly, tokens criptografados no servidor, revogação e limites persistentes |
| Dados | Supabase/PostgreSQL com RLS por conta, revisões, validação no servidor e no banco |
| Caixa e DRE | Caixa como principal, DRE em área própria, dados independentes na mesma conta |
| Conexão | Estado de salvamento, rascunho pendente criptografado e tentativa de recuperação |
| Administração | Permissão no banco, indicadores agregados, filtros e gráficos de evolução |
| Privacidade | Política configurável, estatísticas opcionais, exportação e solicitação de exclusão com análise de retenção |
| Backup | Arquivo financeiro criptografado, workflow externo preparado, restauração verificada e modo de manutenção |
| Publicação | Funções Netlify, build sem segredos, variáveis de exemplo e instruções para atualizar o mesmo projeto |

## Testado localmente

Testes automatizados de API, PostgreSQL/RLS, isolamento de contas, códigos e sessões, indicadores, dados financeiros, backup/restauração e navegador desktop/móvel. Os testes de autenticação/e-mail usam um provedor simulado; as APIs do aplicativo e SQL são executados. Detalhes em [VALIDACAO.md](VALIDACAO.md).

Resultado da verificação em 6 de novembro de 2026: `npm test` com **24 testes aprovados**, `npm run build` concluído e `npm run test:e2e` aprovado com Chromium em desktop e celular. O ensaio de recuperação comparou valores de caixa e DRE no banco após restaurar um arquivo criptografado.

## Depende das contas e serviços externos

1. SMTP com remetente verificado e templates de código no Supabase. O proprietário informou que ainda não tem SMTP.
2. Migrações no Supabase real, configuração nativa de segurança e permissão administrativa ao proprietário confirmado.
3. Turnstile, segredos nas funções Netlify e deploy do projeto completo.
4. Nome e contato reais do responsável, revisão da política e definições operacionais de retenção.
5. Workflow de backup ativado, chave guardada separadamente e ensaio de recuperação externo. A cópia financeira não substitui backup completo de Auth/PostgreSQL.
6. Validação real com dois e-mails e dois aparelhos antes de convidar o público.

**O código foi alterado; o site já publicado pelo proprietário ainda não recebeu esta versão.** Não foram alteradas contas, senhas ou informações no Supabase real. Cadastro público fica bloqueado até configurar os pré-requisitos. O próximo passo é seguir [PUBLICACAO.md](PUBLICACAO.md), começando pelo e-mail e pela preservação dos dados existentes.
