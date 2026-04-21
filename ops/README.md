# Ops Assets

These files are the starting point for a single-VPS deployment:

- `env/`: production environment templates
- `nginx/`: reverse proxy and rate-limit config
- `systemd/`: service units for the bridge and localhost OpenClaw
- `scripts/`: bootstrap, backup, restore, rotation, and smoke-test helpers

All public traffic should terminate at nginx on `80/443`. The bridge, Postgres,
and OpenClaw should stay bound to localhost or a private interface.
