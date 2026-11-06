#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if ! command -v node >/dev/null 2>&1; then
  printf 'Esta versão com contas requer Node.js 22.13 ou superior (LTS recomendado).\n'
  exit 1
fi
printf 'Caixa Claro. Deixe o terminal aberto; Ctrl+C encerra.\n'
if [ -f .env ]; then
  exec node --env-file=.env server.js
fi
exec node server.js
