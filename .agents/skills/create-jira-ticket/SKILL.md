---
name: create-jira-ticket
description: Create a Jira ticket with the Atlassian CLI (acli) when the user asks to create, file, open, or log an issue, task, bug, or epic.
---

# Create a Jira ticket

Use `acli` when available. Check `command -v acli` and
`acli jira workitem create --help` before use; flags can vary by version.
If the CLI is unavailable or unauthenticated, report that and use another
available Jira tool if appropriate. Do not install tools or change auth without permission.

## Create

Confirm the project and issue type from the request or project context.
Ask when the target is ambiguous. Draft the title and description from the request.

```bash
acli jira workitem create \
  --project <KEY> \
  --type <TYPE> \
  --summary "<title>" \
  --description "<body>"
```

Optional flags, only when requested or established by project conventions:

- `--assignee`: a user, `@me`, or another value supported by CLI help. Do not default to assigning yourself.
- `--parent`: the confirmed epic or parent key.
- `--label`: labels in the format supported by CLI help.
- `--description-file`: use for a long body if supported.

Quote shell arguments safely. Prefer a description file for bodies with shell metacharacters.

## Find a named epic

Check `acli jira workitem search --help`, then search within the selected project.
Replace the placeholders before use and escape values for JQL and the shell.

```bash
acli jira workitem search \
  --jql 'project = "<PROJECT_KEY>" AND type = Epic AND summary ~ "<EPIC_NAME>"' \
  --fields key,summary,status
```

A text match is not an exact identity. Confirm the intended epic from the results.
If there are multiple plausible matches or none, ask rather than guess.

## Report

Return the created issue key and URL. Use the URL returned by Jira or its configured
site; do not hardcode a company domain. If creation times out or the result is
unclear, check whether the issue exists before retrying to avoid duplicates.
