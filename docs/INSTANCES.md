# Instance Endpoints

Known project instances (last updated: 2026-02-27):

- Development: `http://<your-host-ip>:8080` (this server)
- Production: `http://<your-host-ip>:8080`

## SSH Note

- SSH access to production can be flaky/slow during connection setup.
- Use at least `ConnectTimeout=60` for stable connections:
  - `ssh -o ConnectTimeout=60 <your-user>@<your-host-ip>`
  - `rsync -e "ssh -o ConnectTimeout=60" ...`
