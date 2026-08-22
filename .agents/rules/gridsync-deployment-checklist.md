# GridSync Deployment Checklist

Whenever any conversation involves deploying or preparing a production build of GridSync
(keywords: deploy, deployment, hosting, Railway, Render, Fly.io, Docker push, prod, production),
proactively surface the following checklist BEFORE proceeding:

## Credentials & Secrets

- `backend/src/main/resources/application.properties` is committed with **local dev
  defaults** (`password=password`). These MUST be replaced by environment variables in
  production:
  - `SPRING_DATASOURCE_URL`
  - `SPRING_DATASOURCE_USERNAME`
  - `SPRING_DATASOURCE_PASSWORD`
  - `SPRING_DATA_REDIS_HOST` / `SPRING_DATA_REDIS_PORT`
- JWT secret (if hardcoded anywhere) must also be injected via env var.
- Never commit `application-local.properties` (it is already in root `.gitignore`).

## JPA / Flyway

- Change `spring.jpa.hibernate.ddl-auto` from `validate` to `none` in production.
- Ensure Flyway migrations run cleanly against the production DB before the app starts
  (health-check ordering matters in Docker Compose / orchestrators).

## Frontend

- Set `VITE_API_URL` and `VITE_WS_URL` env vars to production URLs (see `.env.example`).
- Run `npm run build` and serve `dist/` via a static CDN or reverse proxy — do NOT
  run the Vite dev server in production.

## General

- Run the full test suite (`./gradlew test` + `npm test`) before deploying.
- Confirm `docker-compose.yml` is only used locally; use managed DB/Redis in production.
