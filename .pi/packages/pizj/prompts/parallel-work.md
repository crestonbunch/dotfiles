---
description: Split independent modifying work across pizj workspaces
argument-hint: "<deliverables>"
---
Assess these deliverables: $@

Use pizj_open_workspace only for independent modifying work or another repository. Start every independent workspace before you wait for any result. After all workers start, use pizj_wait_workspace to join their reports. Then integrate the completed revisions. Give each workspace one concrete assignment contract. Prefer direct or same-tab work when isolation is unnecessary. Use forkPolicy=deny unless the split already requires nested workspaces.
