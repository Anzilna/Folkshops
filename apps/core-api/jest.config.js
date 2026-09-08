/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/*.spec.ts"],
  // Integration tests (real Postgres + Redis) run separately via
  // jest.integration.config.js / `pnpm test:integration` — this default
  // suite stays infra-free, matching db-router.spec.ts's own convention.
  testPathIgnorePatterns: ["/node_modules/", "/dist/", "\\.integration\\.spec\\.ts$"],
};
