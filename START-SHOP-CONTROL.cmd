@echo off
setlocal
cd /d "%~dp0server"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js before starting Shop Control.
  pause
  exit /b 1
)
if not exist .env (
  echo Configure server\.env first. See UPGRADE.md.
  pause
  exit /b 1
)
node -e "for(const name of Object.keys(require('./package.json').dependencies))require.resolve(name)" >nul 2>nul
if errorlevel 1 (
  echo Install dependencies with npm install in the server folder first.
  pause
  exit /b 1
)
echo Open the server address printed below. Default: http://localhost:4000
echo Database setup is a separate step described in UPGRADE.md.
call npm start
pause
