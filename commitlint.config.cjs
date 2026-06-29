module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": [
      2,
      "always",
      ["repo", "docs", "web", "api", "agent", "worker", "shared", "infra", "ci", "deps"],
    ],
  },
};
