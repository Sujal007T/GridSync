# Progress Log

## Scaffolding (2026-08-12)

- Set up a monorepo structure with `/backend` and `/frontend`.
- **Backend**: Spring Boot, Java 21, Gradle.
  - Dependencies: `web`, `data-jpa`, `postgresql`, `flyway`, `websocket`, `data-redis`, `testcontainers`.
  - Configured Flyway for schema migrations. Disabled Hibernate `ddl-auto` (`validate` mode).
  - Created an empty baseline migration `V1__baseline.sql`.
  - Configured Testcontainers for integration tests (will use real Postgres and Redis).
- **Database/Infra**: Added a `docker-compose.yml` at root running Postgres 16 and Redis 7.
- **Frontend**: Scaffolded React + TypeScript using Vite.
  - Added `.env.example` for environment configurations (API and WebSocket URLs).
  - Configured Vitest for unit testing.
- **CI/CD**: Added a GitHub Actions workflow `.github/workflows/ci.yml` that runs `./gradlew test` and `npm test` on every push.
