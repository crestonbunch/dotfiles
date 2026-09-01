---
name: create-jira-ticket
description: Create Jira tickets from the command line using the Atlassian CLI (acli). Use when the user asks to create, file, open, or log a Jira ticket/issue/task/bug, optionally under an epic or assigned to someone.
---

# Create a Jira ticket with acli

`acli` (Atlassian CLI, `/opt/homebrew/bin/acli`) creates Jira work items without needing the MCP or web UI. Faster than MCP for simple ticket creation; use MCP for complex queries/edits.

## Command

```
acli jira workitem create \
  --project <KEY> \
  --type <Task|Bug|Story|Epic> \
  --summary "<title>" \
  --description "<body>" \
  --assignee '@me' \
  --parent <EPIC-KEY> \
  --label <l1,l2>
```

Returns the new work item key and URL, e.g. `✓ Work item SD-775 created: https://duolingo.atlassian.net/browse/SD-775`. Quote the URL back to the user so they can click through.

## Key flags

- `--project` — project key (e.g. `SD`, `DLAA`). Required.
- `--type` — `Task`, `Bug`, `Story`, `Epic`, etc. Required.
- `--summary` — ticket title. Required.
- `--description` — body. Supports basic markdown-ish formatting (`*bold*`, backtick code). Use `--description-file` for long bodies or `--from-file` to read summary+description from a file.
- `--assignee` — accepts `@me`, `default`, an email, or an account ID.
- `--parent` — parent work item key. Use this to put a Task under an Epic.
- `--label` — comma-separated label names.
- `--json` — machine-readable output.

It's `workitem create`, **not** `issue create`. The older `issue` noun does not exist in current acli.

## Finding the parent epic

When the user names an epic ("under the Workbench epic"), look up its key before creating:

```
acli jira workitem search \
  --jql 'project = SD AND type = Epic AND summary ~ "Workbench"' \
  --fields key,summary,status
```

`summary ~ "..."` is a fuzzy text match. If multiple epics come back, ask the user which one rather than guessing.

## Other useful subcommands

- `acli jira workitem view <KEY>` — show a ticket.
- `acli jira workitem search --jql '<JQL>' --fields key,summary,status` — query tickets. Any valid JQL works.
- `acli jira workitem create --generate-json` — emit a JSON template for `--from-json`, useful for tickets with many fields or custom field IDs.

## Tips

- Confirm the project key and epic with the user if either is ambiguous — wrong project means the ticket lands somewhere nobody watches.
- For Duolingo, link returned issue keys as `https://duolingo.atlassian.net/browse/<KEY>` per the team Jira rule.
