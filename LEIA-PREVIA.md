# CaixaClaro · Prévia local

No Windows, extraia o ZIP e abra `ABRIR-PREVIA.cmd`. Com Node.js disponível, o iniciador informa o endereço `http://127.0.0.1:4179`. Clique em **Entrar na conta de teste**. Se a porta estiver em uso, o comando `node scripts/preview.mjs 4181` inicia a prévia na porta 4181.

O banco SQLite da prévia fica na subpasta local `.data-preview`. Ele começa com uma empresa fictícia e é reutilizado ao reiniciar. O servidor escuta somente neste computador. O teste não depende de contas Google, variáveis de ambiente ou credenciais do site publicado.

Se você tiver extraído uma versão anterior e quiser conservar os lançamentos dessa cópia, feche a janela do servidor, coloque os arquivos atualizados na mesma pasta e mantenha a subpasta `.data-preview`.

## Roteiro para comparar

1. Em **Contas**, registre uma venda de `R$ 10.000,00` com data no mês anterior e vencimento no mês atual.
2. Abra a **DRE** no mês da venda. A receita fica em R$ 10.000,00. O caixa continua sem essa entrada.
3. Em **Contas**, registre uma baixa de `R$ 6.000,00` na data de hoje. A operação fica com R$ 4.000,00 em aberto. O caixa recebe somente a baixa de R$ 6.000,00.
4. Abra a **Agenda** e selecione 7, 15 ou 30 dias. Escolha um vencimento dentro da janela para ver os R$ 4.000,00 previstos. A Agenda identifica o saldo realizado e o projetado.
5. Em **Configurações**, defina o saldo inicial, cadastre uma conta de banco e faça uma transferência fictícia. O saldo muda entre as contas. O total de caixa e a DRE permanecem iguais.
6. Use **Registrar no caixa** para criar uma saída avulsa de `1.200,50`. Abra **Histórico** para encontrar, editar, excluir ou exportar a movimentação. No CSV, **Data da venda** deve ficar vazia.
7. Em **Configurações**, crie uma categoria personalizada e use-a em uma operação. Volte a **Configurações**, exclua a categoria e selecione um destino. A movimentação mantém valores e baixas, e o enquadramento na DRE fica preservado.

A DRE continua aceitando lançamentos avulsos, por exemplo para registrar o custo das mercadorias efetivamente vendidas. As operações integradas aparecem como gerenciadas em **Contas**.

## Limites desta prévia

A integração nova foi implementada no servidor local. Para publicar, será preciso implementar e validar a persistência equivalente no Supabase de homologação, inclusive a migração e as permissões. O backup integral da conta de teste é exportável como JSON. A restauração desse backup integral e a apuração automática de estoque e CMV ficam para uma etapa posterior. A importação de backup apenas da DRE continua disponível na aba **Empresas** da DRE.

Para desenvolvimento, use Node.js 24, `npm ci` e `npm test`. Para o teste de navegador, prepare o Chromium do Playwright e rode `npm run test:preview`. A variável `CAIXA_TEST_BROWSER` pode apontar para um executável Chrome existente.
