Commit and push helper

Use the PowerShell script `scripts/commit_and_push.ps1` to stage, commit, and push changes from your machine. This is intended to be run locally where your git credentials and config are available.

Example:

    # from repository root (PowerShell)
    .\scripts\commit_and_push.ps1 -Message "feat: update renderer auto-bind heuristics"

Notes:
- The script stages all changes and uses standard git push. It doesn't store or handle tokens.
- Make sure your Git user.name and user.email are configured and you have authentication set up (Git Credential Manager or GitHub CLI).
