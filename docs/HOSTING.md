# Hosting guide: where to run SchemaSync AI

## The one rule that decides everything

The app's server code connects **directly** to your databases (SQL Server port 1433, Oracle port 1521). So the app must run somewhere that can reach those servers over the network.

| Where your databases are | Where to host | Section |
|---|---|---|
| Only inside the company network (typical DEV / SIT / UAT) | A VM or container **inside** that network | [2](#2-internal-linux-or-windows-vm-with-docker-recommended-for-company-databases), [3](#3-windows-server-without-docker-iis-or-pm2), [5](#5-kubernetes--openshift-internal) |
| In Azure (Azure SQL, SQL MI, VMs in a VNet) | Azure App Service or Container Apps **with VNet integration** | [4a](#4a-azure-app-service--container-apps) |
| In AWS (RDS, EC2 in a VPC) | App Runner / ECS **in the same VPC** | [4b](#4b-aws-app-runner--ecs) |
| Reachable from the internet (public endpoint + firewall rules) | Vercel works | [1](#1-vercel) |
| You only want to demo the app / use the SQL Converter | Vercel works | [1](#1-vercel) |

Check reachability from the machine where the app will run:

```bash
# Linux / macOS
nc -vz dev-sql.company.local 1433
nc -vz ora-sit.company.local 1521
# Windows PowerShell
Test-NetConnection dev-sql.company.local -Port 1433
```

`succeeded` / `TcpTestSucceeded : True` means the app will be able to connect from there.

---

## 1. Vercel

**Good for:** demo mode, the SQL Converter, databases with internet-reachable endpoints.
**Not for:** databases that are only on the company network.

1. Push the code to GitHub ([GITHUB_GUIDE.md](GITHUB_GUIDE.md)).
2. Vercel → **Add New → Project** → import `miriyalas/schemasync-ai` → **Deploy**.
3. **Settings → Environment Variables**:

   | Name | Value |
   |---|---|
   | `APP_PASSWORD` | a strong password (the site is public otherwise) |
   | `APP_USER` | optional, default `admin` |
   | `AI_PROVIDER` | `anthropic` / `openai` / `azure` / `none` |
   | the provider's key | e.g. `ANTHROPIC_API_KEY` |

4. **Redeploy** after changing variables.

Notes:
- Function time: API routes request `maxDuration = 60` seconds. Your plan may allow more or less; very large schemas can need longer. For those, use Docker.
- Outbound IP addresses are not fixed by default. If your database firewall needs an IP allow-list, check Vercel's documentation for the static-IP options on your plan.
- Custom domain: **Settings → Domains**.

## 2. Internal Linux or Windows VM with Docker (recommended for company databases)

**Machine:** 2 vCPU, 4 GB RAM, 20 GB disk is plenty (Ubuntu 22.04/24.04, RHEL 9, or Windows Server with Docker).

**Firewall:** allow the VM to reach each database host on 1433 / 1521. If you use cloud AI, also allow outbound HTTPS (443) to the AI provider.

```bash
# on the VM
git clone https://github.com/miriyalas/schemasync-ai.git
cd schemasync-ai
cp .env.example .env
nano .env                 # set APP_PASSWORD, AI settings
docker compose up -d --build
docker compose logs -f    # check it started
```

Open `http://<vm-name>:3000`.

**Add HTTPS** with Caddy (automatic certificates), using this `Caddyfile` next to `docker-compose.yml`:

```
schemasync.company.local {
    tls internal              # or your company certificate: tls /certs/cert.pem /certs/key.pem
    reverse_proxy schemasync:3000
}
```

Then add the service to `docker-compose.yml`:

```yaml
  caddy:
    image: caddy:2
    ports: ["443:443", "80:80"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
    depends_on: [schemasync]
```

**Update to a new version:**

```bash
git pull && docker compose up -d --build
```

**Automatic deploys from GitHub (optional):** install a **self-hosted GitHub Actions runner** on the VM (GitHub → repository → Settings → Actions → Runners → New self-hosted runner), then add a workflow that runs `git pull && docker compose up -d --build` on push to `main`. Because the runner connects out to GitHub, the VM stays closed to the internet.

## 3. Windows Server without Docker (IIS or PM2)

1. Install Node.js 20 LTS.
2. Get the code and build:

   ```powershell
   git clone https://github.com/miriyalas/schemasync-ai.git
   cd schemasync-ai
   npm ci
   npm run build
   ```

3. Create `.env.local` (copy of `.env.example`) with your settings.
4. Run it as a service:
   - **PM2:** `npm i -g pm2`, then `pm2 start npm --name schemasync -- start`, `pm2 save`. Use `pm2-installer` or NSSM to start it at boot.
   - **NSSM:** `nssm install SchemaSync "C:\Program Files\nodejs\npm.cmd" start` (working directory = project folder).
5. **IIS in front (HTTPS, Windows auth on the site, company certificate):** install **URL Rewrite** and **Application Request Routing**, enable the proxy in ARR, and add a reverse-proxy rule from the site to `http://localhost:3000`.

## 4a. Azure App Service / Container Apps

Use this when the databases are in Azure, or are reachable from an Azure VNet (VPN/ExpressRoute to on-prem).

- **App Service (Linux, Node 20):** deploy from GitHub (Deployment Center), startup command `npm start`, build with `npm ci && npm run build`. Turn on **VNet integration** for the subnet that can reach the databases. Put settings in **Configuration → Application settings**.
- **Container Apps:** build the image with the included `Dockerfile` (push it to ACR or GHCR) and create the app in an environment **with a VNet**. Ingress port: 3000.
- Use **Azure OpenAI** with a private endpoint so AI traffic stays in Azure: `AI_PROVIDER=azure` plus the `AZURE_OPENAI_*` settings.
- Store secrets in **Key Vault** references.

## 4b. AWS App Runner / ECS

- **App Runner:** source = container image built from the `Dockerfile` (ECR). Add a **VPC connector** to the subnets that can reach RDS / your databases. Port 3000.
- **ECS Fargate:** service in private subnets that reach the databases, Application Load Balancer in front, target port 3000.
- Keep secrets in **Secrets Manager** and inject them as environment variables.

## 5. Kubernetes / OpenShift (internal)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: schemasync }
spec:
  replicas: 1
  selector: { matchLabels: { app: schemasync } }
  template:
    metadata: { labels: { app: schemasync } }
    spec:
      containers:
        - name: app
          image: ghcr.io/miriyalas/schemasync-ai:latest
          ports: [{ containerPort: 3000 }]
          envFrom: [{ secretRef: { name: schemasync-env } }]
          readinessProbe: { httpGet: { path: /api/ai/status, port: 3000 } }
---
apiVersion: v1
kind: Service
metadata: { name: schemasync }
spec:
  selector: { app: schemasync }
  ports: [{ port: 80, targetPort: 3000 }]
```

Create the secret: `kubectl create secret generic schemasync-env --from-env-file=.env`. Expose it with your normal Ingress / Route. If `APP_PASSWORD` is set, give the readiness probe an `Authorization` header, or leave the password off and protect the app at the ingress instead.

## Environment variables (all hosts)

| Variable | Required | Purpose |
|---|---|---|
| `APP_PASSWORD` | Strongly recommended | Turns on a username/password prompt for the whole app |
| `APP_USER` | No (default `admin`) | Username for the prompt |
| `AI_PROVIDER` | No (default `none`) | `anthropic`, `openai`, `azure`, `ollama`, `none` |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | If anthropic | Claude |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | If openai | OpenAI |
| `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_API_VERSION` | If azure | Azure OpenAI |
| `OLLAMA_BASE_URL`, `OLLAMA_MODEL` | If ollama | Local model on your network (no data leaves it) |

## Checklist before go-live

- [ ] App reaches every database host/port (`nc` / `Test-NetConnection`)
- [ ] Read-only database logins created ([SECURITY.md](SECURITY.md#database-logins))
- [ ] `APP_PASSWORD` set, or the app is behind SSO / VPN
- [ ] HTTPS enabled
- [ ] AI provider approved by your security team, or `AI_PROVIDER=ollama` / `none`
- [ ] **Test connection** works for each environment in the app
- [ ] A comparison of a small schema completes; Excel downloads
