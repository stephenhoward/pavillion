# Playwright MCP Verification

Use Playwright MCP to verify actual application behavior as ground truth.

## When to Use

- **Test/code conflicts**: Unsure whether a failing test or the code is wrong
- **Feature verification**: Confirm behavior works as intended during development
- **Debugging**: Observe actual behavior when logs or tests are unclear
- **Review**: Validate changes before committing

## Process

1. Run the application (locally or in Docker)
2. Use Playwright MCP browser tools to interact with the feature
3. Observe what actually happens
4. Compare against test assertions or expected behavior
5. Take screenshots to document findings when useful

## The Principle

Playwright MCP provides ground truth. When documentation, tests, and code disagree, the running application shows what's actually happening.
