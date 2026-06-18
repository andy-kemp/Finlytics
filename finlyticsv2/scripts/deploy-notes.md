# Deployment Notes

## Purpose

This file tracks how the v2 deployment flow is intended to work before the final GitHub Actions files are copied into the repository root.

## Current stance

- Keep dev and prod separate.
- Promote the same build artifact from dev to prod.
- Gate production with manual approval.
