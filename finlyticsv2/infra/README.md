# Finlytics v2 Infrastructure

This folder will contain the infrastructure-as-code for v2.

Expected contents:

- Bicep or Terraform templates
- environment parameter files
- deployment helper scripts

Recommended layout:

- `bicep/` for infrastructure definitions
- `parameters/` for dev and prod values
- `modules/` for reusable building blocks

Current scaffold:

- `bicep/main.bicep`
- `bicep/dev.bicepparam`
- `bicep/prod.bicepparam`

