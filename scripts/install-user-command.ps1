#Requires -Version 7.0
[CmdletBinding()]
param(
    [string]$BinDirectory = (Join-Path $HOME '.local/bin'),
    [string]$ProfileDirectory
)
$ErrorActionPreference = 'Stop'
$envatoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$envatoEntry = (Resolve-Path -LiteralPath (Join-Path $envatoRoot 'dist/cli.js')).Path
$envatoNode = (Get-Command node.exe -ErrorAction Stop).Source
$envatoBin = [IO.Path]::GetFullPath($BinDirectory)
if ($ProfileDirectory) { $ProfileDirectory = (Resolve-Path -LiteralPath $ProfileDirectory).Path }
# CMD has additional expansion rules even within double quotes.
foreach ($envatoValue in @($envatoEntry, $envatoNode, $ProfileDirectory)) {
    if ($envatoValue -match '[%"\r\n]') { throw 'Shim paths cannot contain percent, quote, or newline characters.' }
}
$envatoCmd = Join-Path $envatoBin 'envato.cmd'
$envatoPs1 = Join-Path $envatoBin 'envato.ps1'
foreach ($envatoPath in @($envatoCmd, $envatoPs1)) {
    if (Test-Path -LiteralPath $envatoPath) {
        $envatoExisting = Get-Content -LiteralPath $envatoPath -Raw
        if ($envatoExisting -notmatch 'Managed by envato-cli install-user-command') { throw "Existing unrelated command: $envatoPath" }
    }
}
[IO.Directory]::CreateDirectory($envatoBin) | Out-Null
$envatoCmdLines = @('@echo off', 'rem Managed by envato-cli install-user-command', 'setlocal DisableDelayedExpansion')
if ($ProfileDirectory) { $envatoCmdLines += "if not defined ENVATO_PROFILE_DIR set `"ENVATO_PROFILE_DIR=$ProfileDirectory`"" }
$envatoCmdLines += "`"$envatoNode`" `"$envatoEntry`" %*", 'exit /b %errorlevel%'
$envatoPsLines = @('# Managed by envato-cli install-user-command')
if ($ProfileDirectory) { $envatoPsLines += "if (-not `$env:ENVATO_PROFILE_DIR) { `$env:ENVATO_PROFILE_DIR = '$($ProfileDirectory.Replace("'", "''"))' }" }
$envatoPsLines += "& '$($envatoNode.Replace("'", "''"))' '$($envatoEntry.Replace("'", "''"))' @args", 'exit $LASTEXITCODE'
[IO.File]::WriteAllText($envatoCmd, ($envatoCmdLines -join "`r`n") + "`r`n")
[IO.File]::WriteAllText($envatoPs1, ($envatoPsLines -join "`r`n") + "`r`n")
$envatoUserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$envatoEntries = @($envatoUserPath -split ';' | Where-Object { $_ })
if (-not ($envatoEntries | Where-Object { $_.TrimEnd('\', '/') -ieq $envatoBin.TrimEnd('\', '/') })) {
    [Environment]::SetEnvironmentVariable('Path', (($envatoEntries + $envatoBin) -join ';'), 'User')
}
# Applies to this installer process; new shells obtain the persistent user PATH.
if (-not (($env:Path -split ';') -contains $envatoBin)) { $env:Path += ";$envatoBin" }
[ordered]@{ command = $envatoCmd; powershell_command = $envatoPs1; entry = $envatoEntry; user_path = $envatoBin } | ConvertTo-Json -Compress
