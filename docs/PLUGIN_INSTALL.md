# Plugin install paths

The Hermes Station plugin can be installed three ways. All three end
in the same on-disk state under `$HERMES_HOME/hermes-agent/plugins/
platforms/station/`, so they're interchangeable; the difference is
who's driving and how fast `git pull` becomes effective.

```text
                 ┌─────────────────────────────┐
                 │ Source tree (cloned, ./)    │
                 │  server/  plugin.yaml  dist/   │
                 └──────────────┬──────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
   git + symlink            wheel install            wheel + script
   (live dev)               (CI / Docker)            (third-party host)
        │                       │                       │
        ▼                       ▼                       ▼
$HERMES_HOME/hermes-agent/plugins/platforms/station/
   server      → ../../../../..//server         (symlink)
   plugin.yaml → ../../../../..//plugin.yaml    (symlink)
   dist        → ../../../../..//dist           (symlink, or copied)
   __init__.py (generated 3-line shim)
```

For all paths, the package's CLI binary lives at
`$HERMES_HOME/hermes-agent/venv/bin/hms` once `python -m pip install -e .`
(or `pip install hermes-station`) has run inside the agent venv.

## Path 1 — git clone + `hms install` (recommended for development)

```bash
git clone <repo-url> hermes-station
cd hermes-station

pnpm install
~/.hermes/hermes-agent/venv/bin/python -m pip install -e .

hms install
hermes gateway install   # if you haven't enrolled the service yet
hms restart              # if the gateway was already running
```

`-e` (editable) means the venv imports straight from your checkout, so
`git pull` immediately picks up Python changes; `pnpm build` (or
`pnpm dev`) does the same for the SPA.

`hms install` is idempotent — it rewrites the per-file symlinks and
patches `platforms.station` into `~/.hermes/config.yaml` if the
section is missing. Older installs that wrote the section under
`gateway.platforms.station` are migrated to the root-level path on
the next `hms install`.

## Path 2 — pre-built wheel (CI / production deploy)

```bash
hatch build                                                # → dist/*.whl
~/.hermes/hermes-agent/venv/bin/pip install dist/hermes_station-0.1.0-py3-none-any.whl
hms install                                                # writes the symlinks
hermes gateway restart                                     # picks up the plugin
```

The wheel only bundles `hms/**/*.py` + `plugin.yaml` + `README.md` /
`LICENSE` — the React `dist/` is **not** packaged because it's machine-
configurable static output, not Python. Run `pnpm build` separately and
let `hms install` symlink the resulting `dist/` directory.

## Path 3 — copy install (no-symlink hosts, e.g. some Windows shares)

`scripts/install_plugin.sh --copy` deep-copies instead of symlinking.
Use this only on filesystems where symlinks are blocked; updates then
require re-running the script after each pull.

## What `hms install` writes

| Path                                                                                  | Type      | Source         |
|---------------------------------------------------------------------------------------|-----------|----------------|
| `$HERMES_HOME/hermes-agent/plugins/platforms/station/server/`                     | symlink   | repo `server/` |
| `$HERMES_HOME/hermes-agent/plugins/platforms/station/plugin.yaml`                  | symlink   | repo file      |
| `$HERMES_HOME/hermes-agent/plugins/platforms/station/dist/`                        | symlink   | repo `dist/`   |
| `$HERMES_HOME/hermes-agent/plugins/platforms/station/__init__.py`                  | generated | (3-line shim)  |
| `~/.hermes/config.yaml` `platforms.station.enabled: true`                          | YAML key  | upstream config|

Comments and ordering in `config.yaml` are preserved by
`server.lib.yaml_edit.set_scalar_at_path` (we deliberately do *not* round-
trip through `yaml.dump`).

## Uninstall

```bash
hms uninstall                  # removes the symlinks + the platforms.station section
# Pass --keep-config to preserve operator-tuned extras (host / port /
# cors_origins) for a later reinstall.
hermes gateway restart         # gateway forgets us
~/.hermes/hermes-agent/venv/bin/python -m pip uninstall hermes-station
```

## Verifying the install

```bash
hms status
```

Both halves should be green:

```text
Plugin:
  repo:         /path/to/repo
  install dir:  ~/.hermes/hermes-agent/plugins/platforms/station  ✓
  config:       ✓ enabled

Gateway:
  manager:      launchd          # or systemd / unknown
  service:      installed=True running=True
  live pids:    [12345]
```

If `live pids` is empty, the upstream service isn't running — start it
with `hms start` (or `hermes gateway start`). If `install dir` is ✗,
re-run `hms install`. If `config: ✗ disabled`, edit `config.yaml`
directly: ensure `platforms.station` exists at the document root
(any non-empty mapping under that path counts).

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `command not found: hms` | venv `bin/` not on PATH | Use absolute path or alias, see README |
| `ModuleNotFoundError: hermes_constants` | Wrong Python interpreter | `HMS_PYTHON=$HOME/.hermes/hermes-agent/venv/bin/python pnpm dev` |
| `pids_signalled: []` from restart | Process lacks SIGUSR1 perms / stale lock | Fall back to `hms stop && hms start` |
| Plugin not discovered by gateway | Old gateway running with stale plugin cache | `hms restart` (or `hermes gateway restart`) |
| `host_requires_password` on save | LAN host (0.0.0.0) without `password_hash` | Set a password in Settings → Security first |
