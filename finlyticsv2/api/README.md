# Finlytics v2 API

Azure Functions isolated worker starter for Finlytics v2.

## What is here

- `Program.cs` wires the Functions host.
- `Functions/Health.cs` provides a simple health endpoint.
- `local.settings.json.example` shows the dev-time settings shape.

## Security posture

- Use managed identity for Azure resources.
- Keep secrets in Key Vault.
- Do not store production secrets in this folder.
