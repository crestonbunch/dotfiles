---
description: How to run a large multi-step feature (research fan-out, parallel jj workspaces)
alwaysApply: true
---

# Large features: research first, then work in parallel

This rule applies to a large feature with many steps. It does not apply to a
small change, a single-file edit, or a question.

## 1. Ask the clarifying questions first

- Ask every question in one message, before the research starts. Wait for the
  answers.
- Ask about each part of the request that has more than one reading.
- Ask about the scope, the constraints, and the code that the change must not
  touch.
- Ask about a decision that changes the plan: the storage, the API shape, the
  dependency.
- Do not ask about a fact you can read from the repo.

## 2. Fan out research subagents

- Spawn the research subagents in one message, so they run in parallel.
- Give each subagent one question: the shape of the existing code, the API of
  a dependency, the prior art in the repo, the constraints from the tests.
- Give web access to a subagent when the work touches an external API, a
  library, or a standard.
- Use a capable model for research. Use a fast model for a simple lookup.
- Read the reports. Then plan the work.
- Do not write code before the research is complete.

## 3. Do the parallel work in jj workspaces

- Split the feature into parts that touch different files.
- Use the `new-workspace` skill for the workspace of each part.
- Give each subagent one workspace and one part.
- Tell each subagent to commit its work into its own revision.

## 4. Merge the parts into one set of revisions

- Rebase the revisions of the workspaces into one stack, in an order that
  builds and passes the tests.
- Squash a revision that only fixes an earlier revision of the same part.
- Keep one revision for each isolated change. See `vcs.md` for the commit
  message rules and for the ask-first rule on history.
- Run the tests and the linters on the stack.
- Remove each workspace.
