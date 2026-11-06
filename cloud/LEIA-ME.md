# Banco da versão pública

As instruções atuais estão em [../docs/PUBLICACAO.md](../docs/PUBLICACAO.md). A arquitetura anterior, com tokens no navegador e publicação apenas estática, foi substituída por funções de servidor no Netlify.

No **SQL Editor do Supabase**, aplique os arquivos nesta ordem:

1. `schema.sql` — fluxo de caixa, se ainda não aplicado.
2. `002-dre.sql` — DRE, se ainda não aplicado.
3. `003-public-platform.sql` — sessões, limites, métricas e solicitações.
4. `005-data-validation-backups.sql` — validação das gravações, manutenção e restauração.
5. `004-admin-owner.sql` — concessão de administrador à conta confirmada do proprietário; conferir o e-mail antes de executar.

Faça uma cópia dos dados atuais antes de migrar. Estes scripts não apagam contas nem lançamentos. As duas primeiras migrações e as novas migrações são repetíveis. A `004` exige que a conta indicada já exista e esteja confirmada.

A `005` aplica as novas restrições a gravações futuras, sem rejeitar a instalação por causa de um registro histórico incompatível (`NOT VALID`). Audite eventuais registros antigos e corrija-os com o proprietário; não os apague automaticamente. Depois de corrigir, é possível validar as restrições pelo administrador do banco.

Não exponha o schema `private` na Data API. Chave `service_role`/`sb_secret_` é exclusivamente do servidor e da rotina de backup. Não a coloque em HTML, JavaScript público, SQL compartilhado ou mensagens no chat.
