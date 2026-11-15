# Without Docker (systemd)

The server is one Node file. This runs it as a systemd service with SQLite, behind Caddy for HTTPS, on any Linux with systemd 250 or later.

## Install

Install Node 24 or later and Caddy from your distribution or their own packages. Then, from a clone at the latest release tag ([how](README.md#use-a-release)):

```sh
corepack enable
pnpm install --frozen-lockfile --filter @flow-sync/server...
pnpm --filter @flow-sync/server build

sudo install -d /opt/flow-sync
sudo cp packages/server/dist/* /opt/flow-sync/
sudo install -d -m 700 /etc/flow-sync
openssl rand -hex 32 | sudo tee /etc/flow-sync/admin_token > /dev/null
sudo chmod 600 /etc/flow-sync/admin_token

sudo cp deploy/systemd/flow-sync.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now flow-sync
curl http://127.0.0.1:8080/v1/health
```

Check `which node`: the unit runs `/usr/bin/node`. If yours is elsewhere, change `ExecStart` with `sudo systemctl edit --full flow-sync`.

The service runs as a temporary user with no access to the rest of the system. Its database is in `/var/lib/flow-sync` (on some systems `/var/lib/private/flow-sync`, reached through that link), and its log in `journalctl -u flow-sync`.

## HTTPS

Point a DNS name at the host, open ports 80 and 443, and put this in `/etc/caddy/Caddyfile`:

```
sync.example.org {
	reverse_proxy 127.0.0.1:8080
}
```

Then `sudo systemctl reload caddy`. Caddy gets the certificate from Let's Encrypt. Any other reverse proxy works if it adds an `X-Forwarded-For` hop and passes WebSocket upgrades on `/v1/live`.

Use the admin token in `/etc/flow-sync/admin_token` once, from Flow, to claim the instance.

## Settings

The [Docker settings](../deploy/docker/README.md#settings) apply. Add them with `sudo systemctl edit flow-sync`:

```
[Service]
Environment=FLOW_SYNC_QUOTA=5368709120
```

The unit only accepts connections from the same host, so the proxy must run there. For Postgres or S3 on another host, remove `IPAddressAllow` and `IPAddressDeny` from the unit and block port 8080 in your firewall instead: with `FLOW_SYNC_TRUST_PROXY=1`, a client that reaches the port directly can claim any address.

## Update

Check out the new release tag, build again, copy `packages/server/dist/*` to `/opt/flow-sync/`, and run `sudo systemctl restart flow-sync`.

## Not verified

The unit and these steps haven't been run on a host by the project yet. The server itself is the same build the Docker image runs.
