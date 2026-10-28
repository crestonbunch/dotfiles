# Pi device configuration

Model assignments live in `model-defaults.json`. The shared defaults use the
`openai` provider. To customize one device, copy that file to
`model-choices.local.json` and edit the exact `provider/model` IDs and thinking
levels for the parent, fallback subagent, and individual agents. The local file
is gitignored. Partial overrides are supported; omitted fields use defaults.

```sh
cp ~/.pi/agent/model-defaults.json ~/.pi/agent/model-choices.local.json
$EDITOR ~/.pi/agent/model-choices.local.json
```

`~/.local/bin/pi` applies the configuration before launching the next Pi
executable on `PATH`. Keep `~/.local/bin` first on `PATH`. The dotfiles' `.zshrc`
restores this precedence after macOS login setup and mise activation. No npm
package or Homebrew installation is modified.

The launcher generates gitignored `settings.json` using these layers:

1. `settings.defaults.json`: shared non-model defaults.
2. Existing `settings.json`: preserves device identity, installed packages, UI
   preferences, and other runtime settings. An existing installation needs no
   manual settings migration.
3. Resolved model choices: owns startup model/effort, model cycling, subagent
   fallback and role assignments, and the strict supported-model allowlist.

By default, the supported set is derived from all configured assignments,
including the parent. To allow additional models on one device, add a
`supportedModels` array of exact `provider/model` IDs to
`model-choices.local.json`. This list replaces the derived set and must include
every configured role model. It controls both model cycling and the strict
subagent allowlist. Role definitions contain behavior and tools, not hardcoded
models.
`jj-ai-run` uses the configured reviewer model unless its existing environment
or jj config overrides select another model.

Missing local choices restore shared model defaults on the next launch. Invalid
JSON or model choices stop the launcher without overwriting runtime settings.
An active settings lock also stops startup; retry when the other writer is done.
A lock left by a killed process requires manual removal after checking no writer
is active. Generated settings must not be force-added to VCS.

Explicit Pi CLI options and project settings retain their normal precedence.
Resumed sessions retain their recorded model; use `/model` or start a new session
to select the new default. Changes to model choices take effect on the next
launch. For an SDK or an absolute executable path that bypasses the launcher,
apply settings explicitly before creating or reloading the runtime:

```sh
node ~/.pi/agent/model-config.mjs --apply
node ~/.pi/agent/model-config.mjs --model reviewer
```

`PI_CODING_AGENT_DIR` selects a different agent directory. The launcher leaves it
untouched if it has no `model-config.mjs`; otherwise that directory must also
contain the two shared defaults files.

## Tests

```sh
node --test .pi/agent/tests/model-config.test.mjs
bash -n .local/bin/pi .local/bin/jj-ai-run
```
