# Test Validity First

When a test fails, **do not assume the test is correct**.

## Before Fixing Any Failing Test

Ask these questions in order:

1. **Is the test correct?** Does the assertion match expected production behavior?
2. **Is the code correct?** Does the implementation match intended functionality?
3. **Which one is wrong?** The test expectation or the code?

## Tests Can Be Wrong

Tests may have:
- Incorrect assumptions about desired behavior
- Become outdated after intentional functionality changes
- Misunderstood API contracts or specifications
- Tested implementation details rather than requirements

## Code May Be Correct

Code may be:
- Correctly implementing behavior that tests haven't caught up to
- Following specifications that tests misunderstand
- Handling edge cases that tests don't validate properly

## When Uncertain

Ask questions before changing anything:
- "What should the actual behavior be here?"
- "Does this test represent a real user requirement?"
- "Has intended behavior changed since this test was written?"
- "Does the code match the specification/documentation?"

## The Rule

Never blindly "make tests pass" without understanding why they're failing.

- Fix bugs in **code** when tests correctly identify problems
- Fix bugs in **tests** when they incorrectly expect wrong behavior
- **Never** make quick fixes to code or tests that violate project standards
