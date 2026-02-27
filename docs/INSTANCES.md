# Instance Endpoints

Known project instances (last updated: 2026-02-27):

- Development: `http://192.168.3.139:8080` (this server)
- Production: `http://192.168.3.246:8080`

## SSH Note

- SSH access to production can be flaky/slow during connection setup.
- Use at least `ConnectTimeout=60` for stable connections:
  - `ssh -o ConnectTimeout=60 multi-command-runner@192.168.3.246`
  - `rsync -e "ssh -o ConnectTimeout=60" ...`
