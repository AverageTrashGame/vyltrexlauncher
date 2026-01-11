Vyltrex Launcher PRO3 (fixed)

Fixes:
- Shows extraction progress (not stuck at 0%)
- Launch uses the REAL exe name found during install (no more GeometryDash.exe mismatch)
- EXE name in games.json is: Vyltrex GDPS.exe

IMPORTANT if you already installed before:
- Click Uninstall in the app, then Download again.
  (Or delete: %APPDATA%\VyltrexLauncher\Meta\installed.json)

Run:
  npm install
  npm start

Build installer EXE:
  npm run build
Then look in dist\

Install location:
  %APPDATA%\VyltrexLauncher\Games\<game_id>
