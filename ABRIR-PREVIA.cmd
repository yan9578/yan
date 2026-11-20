@echo off
cd /d "%~dp0"
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Instale o Node.js 24 LTS para executar a previa.
  pause
  exit /b 1
)
echo Abra http://127.0.0.1:4179 no navegador.
echo Selecione Entrar na conta de teste.
echo Mantenha esta janela aberta enquanto estiver usando a previa.
node scripts\preview.mjs
if errorlevel 1 pause
