@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call npm install
)
if not exist .env (
  echo Missing .env file. Copy .env.example to .env and set DATABASE_URL.
  pause
  exit /b 1
)
start "" "http://localhost:5174"
node server.js
