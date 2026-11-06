# Backup e recuperação

A rotina implementada gera arquivos financeiros criptografados com AES-256-GCM e verifica integridade antes de restaurar. Há teste de restauração efetiva em PostgreSQL/PGlite. **O agendamento e o envio externo ainda não estão ativos na conta do proprietário.**

## Escopo e limites

O arquivo `.ccbackup` contém `cashbooks` e `dre_books`, UUID do proprietário e revisões. Não contém senhas, identidades do Supabase Auth, sessões, permissões administrativas, solicitações de privacidade ou configurações dos serviços. Para recuperar o projeto inteiro após perda de Auth/banco, é necessário também um backup completo de PostgreSQL/Auth oferecido pela operação/provedor, com procedimento próprio e proteção equivalente.

A coleta é lógica, paginada e limitada a **50 MB** de documentos. Cada linha é lida de forma consistente, mas o conjunto pode refletir momentos diferentes durante uma coleta com gravações concorrentes; não é um snapshot global transacional nem recuperação por ponto no tempo. Ao atingir o limite, o processo falha claramente e não conclui um arquivo parcial. Para maior volume ou consistência global, migre para backup PostgreSQL transacional/PITR, conforme recursos e custos do plano.

A restauração usa UUIDs existentes. Ela não recria contas e não remapeia dados por e-mail. Se uma conta foi excluída, a chave estrangeira impede recriá-la indiretamente pela restauração financeira. Antes de restaurar uma cópia completa do banco/Auth, reaplique as exclusões posteriores e revogue sessões restauradas conforme o procedimento de sua operação.

## Chave e configuração

Gere uma chave exclusiva executando **no seu computador**:

```sh
node scripts/generate-secret.mjs
```

Guarde o resultado em um gerenciador de segredos e configure `BACKUP_ENCRYPTION_KEY`. Não mande o resultado no chat. Ela deve conter 32 bytes em Base64 e ser diferente de `SESSION_SECRET`. Guarde uma cópia recuperável da chave separada dos arquivos; perder a chave torna as cópias indecifráveis. Mantenha as chaves antigas enquanto houver arquivos protegidos por elas.

Os comandos usam também `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`. Em execução manual, uma cópia privada de `.env` pode carregar os valores com `node --env-file=.env ...`. Não passe chaves em argumentos de linha de comando nem publique arquivos de ambiente.

## Criar e enviar uma cópia

```sh
node --env-file=.env scripts/backup-cloud.mjs backups/financeiro.ccbackup
```

O arquivo é criado exclusivamente, com permissão privada; um arquivo com o mesmo nome não é sobrescrito. O servidor registra “arquivo criado” e executa a limpeza de eventos e sessões vencidas. Guarde essa cópia fora da máquina/site de origem, em armazenamento privado, com retenção de 30 dias para o piloto.

Somente **depois de conferir o upload externo**, registre o envio:

```sh
node --env-file=.env scripts/report-backup.mjs --uploaded backups/financeiro.ccbackup
```

Esse registro contém data e hash SHA-256; não envia os dados ao painel administrativo. Ele depende da confirmação operacional do upload. Não use o comando para fingir um envio que não aconteceu. O painel mostra quando foi a última cópia externa e quantas falhas ocorreram na semana.

## Agendar pelo GitHub

O arquivo [.github/workflows/backup.yml](../.github/workflows/backup.yml) prepara uma execução diária às 05:00 UTC (02:00 de Brasília). Para ativar:

1. Coloque o código no repositório privado e mantenha GitHub Actions habilitado.
2. Crie um environment chamado `backups`.
3. Nesse environment, crie a variável `SUPABASE_URL` e os secrets `SUPABASE_SERVICE_ROLE_KEY` e `BACKUP_ENCRYPTION_KEY`.
4. Execute manualmente o workflow e confira o sucesso. O artefato contém somente o arquivo criptografado, com retenção configurada de 30 dias; o registro de envio ocorre após o upload.
5. Baixe um artefato e faça o ensaio de restauração. Verifique falhas/atrasos e as notificações do GitHub. O agendamento depende das condições do GitHub, pode atrasar e pode ser desativado por inatividade. Cadastros são recusados se a última cópia externa tiver mais de 48 horas.

Mantenha uma cópia criptografada independente se a continuidade exigir proteção também contra perda da conta GitHub. Verifique franquias e armazenamento dos artefatos; retenção não significa custo zero. Remova cópias manuais que ultrapassem o prazo de retenção, sem prejudicar obrigações legais aplicáveis.

## Restaurar com conferência

Em uma pasta privada, baixe o arquivo e carregue a chave correspondente. Primeiro confira sua integridade e o projeto de origem **sem gravar nada**:

```sh
node --env-file=.env scripts/restore-cloud.mjs backups/financeiro.ccbackup
```

Essa simulação valida o conteúdo e mostra contagens e projeto de destino. Não comprova, sozinha, que as identidades já existem no banco de destino. Confira as contas/UUIDs e as migrações antes de aplicar.

Para aplicar ao projeto configurado, é obrigatório confirmar o hostname completo. Este exemplo usa o projeto atual do proprietário e **substitui documentos financeiros diferentes**:

```sh
node --env-file=.env scripts/restore-cloud.mjs backups/financeiro.ccbackup --apply --confirm-project=ppzlnrydbdxdkbytrwly.supabase.co --allow-overwrite
```

Use esse comando somente em recuperação autorizada e com o destino conferido. Sem `--allow-overwrite`, um documento atual diferente bloqueia a restauração. Backups de outro projeto são recusados, salvo a opção explícita `--allow-cross-project`; ela não altera os UUIDs nem cria contas.

O processo:

1. Confere integridade, formato e confirmação de destino antes de alterar o banco.
2. Ativa manutenção: leituras e gravações financeiras de usuários ficam bloqueadas tanto na API quanto em RLS.
3. Gera uma cópia criptografada pré-restauração em `backups/antes-restauracao-....ccbackup`.
4. Restaura cada documento em transação, mantendo revisões maiores para recusar abas antigas.
5. Lê os documentos novamente e compara os valores.
6. Registra a verificação e desativa manutenção somente após sucesso.

Não há transação única envolvendo todo o arquivo. **Se uma etapa falhar, a manutenção permanece ativa** para não reabrir um conjunto parcialmente restaurado. Leia o erro, corrija o problema e reexecute a mesma restauração; documentos já iguais são aceitos sem duplicação. Preserve a cópia pré-restauração para desfazer alterações, se necessário. Não desative manutenção apenas para ocultar uma falha. Se um operador concluir a conferência por outro procedimento, a operação administrativa `select public.app_maintenance(false);` pode reabrir o serviço pelo SQL Editor, após verificar os dados.

Confira login, caixa, DRE e exportações de duas contas após a recuperação. Faça um ensaio periódico em ambiente separado, com identidades e UUIDs de teste compatíveis. Um backup só deve ser considerado operacional depois de verificar também o upload e a restauração, além da criação do arquivo.
