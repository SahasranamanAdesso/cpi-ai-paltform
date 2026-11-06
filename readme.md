# Getting Started

Welcome to your new CAP project.

It contains these folders and files, following our recommended project layout:

File or Folder | Purpose
---------|----------
`app/` | content for UI frontends goes here
`db/` | your domain models and data go here
`srv/` | your service models and code go here
`readme.md` | this getting started guide

## First-time setup (after cloning)

```bash
npm install
cds watch
```

Open iFlow Studio and click the **gear icon** at the top right (it also opens automatically when nothing is configured yet).

- **Primary model**: pick a model from the dropdown and enter its API key. It is used for every request.
- **Secondary model** (optional): another model with its own API key. If the primary model fails, iFlow Studio switches to it automatically.

- **CPI tenant** (optional, needed for Deploy): client ID, client secret, token URL and API base URL from a service key of the *Process Integration Runtime* service (plan `api`), plus the target package ID.

Click **Save**. The settings are written to `.env` in the project root (git-ignored), take effect immediately and are tested right away. The status in the header shows which model is in use and whether the fallback was needed.

## Deploying to CPI

**Deploy to CPI** generates the flow from your scenario and deploys it to the tenant, using [`@david10ten/deployer`](https://github.com/SahasranamanAdesso/cpi-ai-deployer). The Deployment panel shows the progress and the final status. If the deployment fails, it shows the error SAP reports for the artifact. **Fix & Redeploy** sends that error back to the AI, regenerates the flow and deploys it again (up to 5 attempts).

**Flows with deployment errors on the tenant** lists every artifact currently in ERROR status with its SAP error, including ones not deployed from iFlow Studio.

On BTP the dialog is read-only. Set the variables listed in `.env.example` as environment variables of the `cpi-ai-platform-srv` app.

## Next Steps

- Open a new terminal and run `cds watch`
- (in VS Code simply choose _**Terminal** > Run Task > cds watch_)
- Start with your domain model, in a CDS file in `db/`

## Learn More

Learn more at <https://cap.cloud.sap>.
