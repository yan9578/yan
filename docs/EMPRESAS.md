# Empresas no Fluxo de Caixa

Entre pelo Google e abra **Fluxo de caixa**. O seletor **Empresa do Fluxo de Caixa** usa o mesmo cadastro e os mesmos identificadores da DRE. Escolha uma empresa para consultar suas entradas, saídas, saldo, gráficos e histórico. Busca, período e exportação CSV também se limitam a essa empresa.

## Cadastrar e editar

**Cadastrar empresa** cria nome e setor no cadastro compartilhado. Empresas já cadastradas na DRE aparecem na lista, sem necessidade de repetir o cadastro. **Editar empresa** atualiza o mesmo nome/setor que a DRE utiliza. **Atualizar empresas** recarrega o cadastro após alterações feitas em outra janela/aparelho.

O cadastro de uma empresa no caixa não cria lançamentos de DRE. Um recebimento no caixa não vira receita de competência automaticamente; os dois módulos conservam seus registros e cálculos independentes. As alterações reais feitas na DRE atualizam o cadastro do caixa; o modo de demonstração não acrescenta empresas fictícias a ele.

Cada novo lançamento informa sua empresa. Ao editar, é possível corrigir esse vínculo explicitamente. Depois de salvar, a visualização acompanha a empresa escolhida. A opção “Experimentar com exemplos” acrescenta dados somente ao caixa vazio da empresa selecionada.

## Lançamentos anteriores

Os registros existentes que não tinham empresa permanecem em **Sem empresa definida**, com seus valores, IDs e datas originais. Não se presume que pertençam à primeira empresa cadastrada, mesmo quando só há uma empresa na DRE.

- Se todos forem da mesma empresa, selecione-a no painel de vinculação e clique em **Vincular lançamentos**. Confira a quantidade e o nome antes de confirmar.
- Se forem de empresas diferentes, use **Editar** em cada lançamento para escolher a empresa correta.
- Cadastre a empresa antes da vinculação caso ela ainda não exista.

Não são permitidos novos lançamentos nesse grupo sem identificação; escolha ou cadastre uma empresa para começar. A vinculação é salva com a mesma proteção de revisão das demais alterações. Um conflito com outra janela preserva os dados do servidor e o rascunho pendente, sem confirmar sucesso falso.

## Histórico, persistência e isolamento

Os vínculos ficam no Supabase junto com os lançamentos da conta. Sair e entrar, trocar de aparelho ou selecionar outra empresa não apaga os registros. A preferência de empresa selecionada é local a cada navegador/conta; a informação financeira é armazenada no servidor.

Se um cadastro for removido na DRE, os lançamentos de caixa que o referenciam continuam acessíveis na lista como **cadastro removido**. O nome registrado no lançamento serve de identificação histórica quando não existe mais no cadastro ativo. O usuário pode consultar ou editar o vínculo desses registros para uma empresa ativa; eles não são transferidos automaticamente nem perdidos. Novos lançamentos e exemplos exigem um cadastro ativo.

As empresas de uma mesma conta pertencem ao mesmo usuário. RLS continua isolando as contas por UUID; duas pessoas podem ter empresas de mesmo nome sem compartilhar documentos. Não foi introduzido acesso compartilhado entre usuários ou permissões por empresa.

## Compatibilidade e publicação

Não há SQL novo para executar, troca de chaves ou alteração da configuração Google. As tabelas JSON existentes aceitam os campos opcionais `company` e `companyName` do caixa. A validação do servidor preserva e verifica esses campos. Backups e exportação da conta os incluem; cópias anteriores sem os campos continuam válidas. O limite existente de 5.000 lançamentos de caixa é por conta.

As gravações de cadastro usam o documento e a revisão da DRE já existentes, preservando seus lançamentos. As gravações do caixa continuam em documento e revisão próprios. A concorrência entre janelas é recusada pelo controle de revisão; a interface recarrega o estado mais recente antes de permitir uma nova tentativa.

Após a atualização da branch `main`, aguarde o deploy da Vercel ficar **Ready**, recarregue o site e confira primeiro uma conta que já possua dados. Testes locais executados com Auth externo simulado e PostgreSQL/RLS/APIs reais estão em [VALIDACAO.md](VALIDACAO.md).
