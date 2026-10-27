# Self-host OpenCode with Docker Compose

This deployment runs the OpenCode web UI and API together on a persistent Linux host. Caddy provides HTTPS and proxies the browser to the same-origin OpenCode server, avoiding a separate E2B preview URL. It is not a Vercel/serverless deployment: the OpenCode server needs a persistent process, workspace filesystem, and PTY support.

## Requirements

- A Linux VPS or VM with Docker Engine and the Docker Compose plugin.
- A DNS name whose A/AAAA record points to the server.
- Inbound TCP ports 80 and 443 open in the server firewall. Caddy obtains and renews the TLS certificate automatically.
- A valid OpenRouter API key. The free model configured here may still have provider-side availability or rate limits.

## Configure and start

From the repository directory on the server:

```sh
cp .env.example .env
mkdir -p workspace
```

Edit `.env` on the server and set:

- `OPENCODE_DOMAIN` to the DNS name pointing to this host.
- `OPENCODE_SERVER_PASSWORD` to a unique, long password.
- `OPENROUTER_API_KEY` to the provider key. Keep it only in `.env` or the host's secret manager; never commit it or put it in a `VITE_*` variable.
- `OPENCODE_WORKSPACE` optionally to an absolute host path containing the project files OpenCode should access.

Then start the stack:

```sh
docker compose up -d
docker compose logs -f opencode
```

Open `https://<OPENCODE_DOMAIN>`. The web UI and API are served from one origin. On first use, connect using the server password from `.env`; the browser stores the authorized connection for later visits.

## Persistence and updates

- `OPENCODE_WORKSPACE` is a host directory mounted at `/workspace` in the container.
- Named Docker volumes retain OpenCode's database, auth/config data, state, and Caddy certificates across container updates.
- To update the published OpenCode image:

  ```sh
  docker compose pull
  docker compose up -d
  ```

Back up the workspace directory and the `opencode_data` Docker volume. Do not publish `.env`; the repository already ignores it.

## Security notes

The OpenCode server is password-protected and is not published directly on port 4096; only Caddy's HTTPS ports are exposed. Keep the password and API key private, restrict VPS access, and use a fresh provider key if the previous experimental key has expired. The committed `deploy/opencode.json` contains model settings only and no credentials.
