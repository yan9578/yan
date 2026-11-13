# Entrega atual: Google exclusivo na interface e caixa por empresa

O proprietário confirmou o acesso real com Google no site da Vercel. Essa autorização foi preservada. A interface agora apresenta somente o Google; formulários de senha, cadastro e recuperação por e-mail ficam ocultos, junto com seu CAPTCHA. As rotas existentes e as credenciais não foram removidas. `PASSWORD_LOGIN_VISIBLE=false` é o padrão; a reexibição futura exige ativação explícita.

## Fluxo de Caixa por empresa

- Seletor de empresa com cadastro e edição do nome/setor no mesmo documento e com os mesmos IDs da DRE.
- Entradas, saídas, saldo, formas de pagamento, gráficos, busca, histórico e CSV restritos à empresa selecionada.
- Edição de lançamento permite escolher sua empresa; a visualização acompanha o destino escolhido. Exclusão e desfazer preservam o vínculo.
- Exemplos de caixa são adicionados somente à empresa selecionada, preservando os lançamentos de todas as outras.
- Dados antigos não são atribuídos por suposição: ficam em “Sem empresa definida”. Vinculação em lote exige escolha e confirmação; lançamentos de empresas diferentes podem ser vinculados individualmente em Editar.
- Os lançamentos, cálculos e demonstração da DRE permanecem independentes do caixa. O cadastro compartilhado preserva suas entradas e usa o controle de revisão já existente.
- Se uma empresa sem lançamentos de DRE for removida na DRE, seu histórico de caixa continua acessível em um grupo identificado como cadastro removido. Não é transferido a outra empresa.
- Sem nova migração SQL ou substituição dos dados existentes. Os documentos JSON atuais armazenam os vínculos opcionais dos lançamentos; backups e exportação da conta os preservam.

## Validação

`npm test`: **38 testes aprovados**. Build concluído. Testes de navegador cobrem Google exclusivo, os dois caixas do exemplo, cadastro compartilhado, renomeação, CSV, edição/transferência, exclusão/desfazer, exemplos, dados antigos, persistência após logout, dois aparelhos, conflitos de revisão de caixa/cadastro, isolamento entre usuários, cadastro removido e celular. Os testes anteriores de DRE, sessão, administração, rascunhos e autenticação opcional também passaram.

OAuth Google/Supabase Auth e Cloudflare são simulados nos testes locais; APIs, navegador e PostgreSQL/RLS são executados. A confirmação anterior de login real foi fornecida pelo proprietário. Não houve acesso administrativo remoto aos serviços ou alteração dos seus segredos por este executor.

## Publicação e uso

O repositório conectado à Vercel publica a branch `main`. Aguarde a publicação ficar Ready e recarregue o site. Não é necessário trocar chaves, refazer OAuth ou executar SQL para estas alterações. Veja [EMPRESAS.md](EMPRESAS.md) para conferir as empresas e vincular os lançamentos anteriores.
