/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/*.integration.spec.ts"],
  // Real Postgres + Redis round-trips, concurrency tests, bcrypt hashing —
  // slower than the mocked unit suite by design.
  testTimeout: 30000,
};
