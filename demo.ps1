# Driftfix demo: run this in PowerShell from the driftfix folder while screen recording.
# It builds a throwaway repo from examples/support-bot, shows it crash on the current
# OpenAI SDK, then lets Driftfix fix it, prove it and prepare the pull request.

$ErrorActionPreference = "Continue"
$root = $PSScriptRoot
$py = Join-Path $root ".venv\Scripts\python.exe"
$driftfix = Join-Path $root ".venv\Scripts\driftfix.exe"
$demo = Join-Path $env:USERPROFILE "driftfix-demo\support-bot"

function Say($text) { Write-Host "`n# $text" -ForegroundColor DarkYellow; Start-Sleep -Milliseconds 900 }

if (Test-Path (Split-Path $demo)) { Remove-Item -Recurse -Force (Split-Path $demo) }
New-Item -ItemType Directory -Force (Split-Path $demo) | Out-Null
Copy-Item -Recurse (Join-Path $root "examples\support-bot") $demo
Get-ChildItem $demo -Recurse -Directory -Filter __pycache__ | Remove-Item -Recurse -Force
Set-Location $demo
"__pycache__/" | Out-File -Encoding ascii .gitignore
git init -q 2>$null; git config core.autocrlf false; git config user.email demo@driftfix.dev; git config user.name demo
git add -A; git commit -q -m "Support bot on openai 0.28"
Clear-Host

Say "A support bot written for openai 0.28. With today's SDK it crashes:"
$env:OPENAI_API_KEY = "sk-test"
cmd /c "`"$py`" -c `"import app; print(app.answer('When will my order ship?'))`" 2>&1" | Select-String -Pattern "APIRemovedInV1|You tried to access|File .*app.py" | ForEach-Object { $_.Line }

Say "Driftfix finds every affected line:"
& $driftfix scan .

Say "Fix it, run the repo's own tests, commit to a branch, write the PR:"
& $driftfix run .

Say "The diff a maintainer reviews:"
git --no-pager diff HEAD~1 --color -- app.py

Say "And the pull request description:"
Get-Content DRIFTFIX_PR.md | Select-Object -First 24
