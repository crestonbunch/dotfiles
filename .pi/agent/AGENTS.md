<!-- BEGIN personal-agent-rules -->
## Personal agent rules

Before work, inspect the YAML frontmatter in each Markdown file under
`/Users/creston/.agents/rules/personal/`.

- Read and apply each complete file where `alwaysApply` is `true`.
- If `alwaysApply` is `false`, read and apply the file when its description
  matches the task.
- Use skills from `/Users/creston/.agents/skills/` when a rule names one.

## Subagent delegation

Use subagents frequently, inside and outside pizj. Prefer delegation when a task
has an independent lookup, research, analysis, debugging, implementation, or
review part. Run independent subagents in parallel when the available tools
permit it. Keep only small, indivisible tasks in the root agent.

- Use Luna for information and summaries without analysis. Do not use Luna for
  analysis or decisions.
- Use Terra for analysis and source explanations. Do not use Terra for
  decisions.
- Use Sol for decisions, difficult coding, and deep analysis.
- Increase the model tier or thinking level when a result is unsatisfactory.
- Give each subagent one specific assignment and the context that it needs.
- Review each result before you use it. The root agent owns final decisions and
  verification.
- Use pizj tools while pizj mode is active. Outside pizj mode, use the available
  subagent tools.

## Pizj orchestration

Pizj is off by default. Use `/pizj on` for work that benefits from visible
subagents or isolated jj workspaces.

- Do the work directly when one agent and one workspace are sufficient.
- Use `pizj_delegate` for read-only work in a background stacked pane. The
  pane closes after the agent reports. All panes in one zellij tab use the same
  jj workspace.
- Use `pizj_open_workspace` for independent modifying work or another
  repository. Each workspace gets one zellij tab. Start all independent
  workspaces first. Then use `pizj_wait_workspace` to collect each report.
- Give a workspace one concrete deliverable. Use `forkPolicy=deny` by default.
- Use Luna for information and summaries without analysis. Do not use Luna for
  decisions.
- Use Terra for analysis and source explanations. Do not use Terra for
  decisions.
- Use Sol for decisions, difficult coding, and deep analysis.
- Increase the model tier or thinking level when a lower tier is unsatisfactory.
- While pizj mode is active, do not use another subagent plugin. Outside pizj
  mode, other subagent plugins remain available.
- The root workflow coordinator reviews and integrates workspace revisions.
<!-- END personal-agent-rules -->
