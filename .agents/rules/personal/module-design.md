---
description: Module boundaries and interfaces
alwaysApply: true
---

# Module design

Minimize coupling and caller complexity, not class or line count.

- Prefer deep modules: useful behavior behind simple, documented caller contracts, including side effects and errors.
- Hide design decisions and shared knowledge inside the owning module; private fields alone do not hide behavioral coupling.
- Group by knowledge rather than execution order. Avoid pass-through wrappers and shallow layers without distinct value.
- Make common operations easy without speculative interfaces. Pull complexity and recovery into the module when it can fulfill the contract.
