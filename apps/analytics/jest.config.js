/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/*.spec.ts"],
  // Real-infra tests (Kafka + Debezium + Elasticsearch) are a separate,
  // not-yet-added test:cdc script given container startup cost — this
  // default suite stays infra-free, same split as core-api's
  // test/test:integration. See docs/decisions/0009's "What's deliberately
  // not built".
  testPathIgnorePatterns: ["/node_modules/", "/dist/", "\\.integration\\.spec\\.ts$"],
};
