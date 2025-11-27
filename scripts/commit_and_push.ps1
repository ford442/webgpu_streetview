<#
PowerShell helper: commit_and_push.ps1
Usage:
  .\scripts\commit_and_push.ps1 -Message "your commit message"
  or run without args to be prompted for a message.

This script will:
 - detect if there are any git changes
 - stage all changes (git add -A)
 - create a commit with the provided or auto message
 - push to the current branch (git push -u origin BRANCH)

Note: You must run this locally in a repository with Git configured and credentials available (credential manager or gh auth). The script does not accept or store tokens.
#>
param(
    [string]$Message
)

function ExecGit([string]$args) {
    $proc = Start-Process -FilePath git -ArgumentList $args -NoNewWindow -RedirectStandardOutput -RedirectStandardError -PassThru -Wait
    $out = $proc.StandardOutput.ReadToEnd()
    $err = $proc.StandardError.ReadToEnd()
    return @{ ExitCode = $proc.ExitCode; StdOut = $out; StdErr = $err }
}

# Ensure we are in repo root (script assumes it's run from repo root)
if (-not (Test-Path ".git")) {
    Write-Host "Warning: .git directory not found. Run this from the repository root." -ForegroundColor Yellow
}

# Check for changes
$st = ExecGit('status --porcelain')
if ($st.ExitCode -ne 0) {
    Write-Error "git status failed: $($st.StdErr)"
    exit $st.ExitCode
}

if (-not $st.StdOut.Trim()) {
    Write-Host "No changes to commit."
    exit 0
}

if (-not $Message) {
    $inputMsg = Read-Host "Commit message (leave empty to use auto message)"
    if ($inputMsg) { $Message = $inputMsg }
}

if (-not $Message) {
    $Message = "chore: auto-commit changes $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
}

Write-Host "Staging all changes..."
$add = ExecGit('add -A')
if ($add.ExitCode -ne 0) { Write-Error "git add failed: $($add.StdErr)"; exit $add.ExitCode }

Write-Host "Committing with message: $Message"
$commit = ExecGit(@("commit -m", "`"$Message`"" ) -join ' ')
if ($commit.ExitCode -ne 0) {
    # If nothing to commit (race), exit cleanly
    if ($commit.StdErr -match 'nothing to commit') {
        Write-Host "Nothing to commit (another process may have committed)."
    } else {
        Write-Error "git commit failed: $($commit.StdErr)"
        exit $commit.ExitCode
    }
}

# Get current branch
$branchRes = ExecGit('rev-parse --abbrev-ref HEAD')
if ($branchRes.ExitCode -ne 0) { Write-Error "Failed to get branch: $($branchRes.StdErr)"; exit $branchRes.ExitCode }
$branch = $branchRes.StdOut.Trim()

Write-Host "Pushing to origin/$branch..."
$push = ExecGit("push -u origin $branch")
if ($push.ExitCode -ne 0) {
    Write-Error "git push failed: $($push.StdErr)"
    exit $push.ExitCode
}

Write-Host "Push complete." -ForegroundColor Green

