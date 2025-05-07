# How to Contribute to Pavillion

Thank you for your interest in contributing to Pavillion. Please take a moment to review
this document to make participation easy and effective for everyone involved.

Key links for contributors:
- [Project Overview & Principles](../README.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Issues Tracker](https://github.com/stephenhoward/pavilion/issues)

## Getting Started

### Prerequisites

- Node.js (check package.json for version requirements)

### Setting Up Your Development Environment

1. Clone the repository:
   ```
   git clone https://github.com/stephenhoward/pavilion.git
   cd pavilion
   ```
2. Install dependencies:
   ```
   npm install
   ```
3. Start the development server:
   ```
   npm run dev
   ```

We recommend reviewing the roadmap and open issues to find areas where you can contribute effectively.

## Project Structure

Pavillion follows a domain-driven design with clear boundaries between functional areas.:

- `src/common/`: Shared models and utilities
- `src/client/`: Frontend Vue.js application
- `src/server/`: Backend Express application
  - `src/server/authentication/`: Authentication services
  - `src/server/activitypub/`: Federation implementation
  - `src/server/accounts/`: Account management
  - `src/server/calendar/`: Calendar and event functionality
  - `src/server/configuration/`: System settings
  - `src/server/common/`: Shared server utilities

Each domain has its own:
- API endpoints and controllers
- Service layer for business logic
- Domain models
- Data entities

The project is structured this way so that when we explore scaling the service up to handle more
activity we will have a clear path to creating separate microservices for each domain.

## Areas of Contribution

There are multiple ways you can be involved with the project

### Documentation
- Improve or add JSDoc comments
- Update or create user guides
- Add examples for complex features
- Translate documentation

### Translations
- Add new language support
- Improve existing translations
- Help test multilingual features

### Code
- Implement new features
- Fix bugs
- Improve performance
- Enhance accessibility
- Add tests

### Accessibility Testing
- Audit interfaces for screen reader compatibility
- Test keyboard navigation and tab order
- Verify appropriate color contrast ratios
- Check for proper ARIA attributes
- Test with various assistive technologies
- Validate compliance with WCAG 2.1 AA standards

## Opening Issues

Before opening a new issue, please:
- Check the existing issues to avoid duplicates
- Provide as much detail as possible, including steps to reproduce for bugs
- Tag issues appropriately

## Development Workflow

### Branching Strategy

1. Create a feature branch from `main`:
   ```
   git checkout -b feature/your-feature-name
   ```
   or for bugfixes:
   ```
   git checkout -b fix/issue-description
   ```

2. Make your changes with clear, focused commits

3. Keep your feature branch updated with the main branch:
   ```
   git fetch origin
   git rebase origin/main
   ```

### Commit Messages

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification for commit messages to provide a consistent format that's both human and machine-readable.

Basic format:
```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

#### Commit Types
- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation changes
- `style`: Changes that don't affect code functionality (formatting, etc.)
- `refactor`: Code changes that neither fix a bug nor add a feature
- `perf`: Performance improvements
- `test`: Adding or correcting tests
- `chore`: Changes to the build process, tooling, etc.

## Submitting Changes

1. Push your changes to your fork
2. Submit a pull request to the main repository
3. Ensure the PR description clearly describes the problem and solution
4. Reference any related issues

### Pull Request Guidelines

- Keep PRs focused on a single topic
- Update documentation for any changed functionality
- Include tests for new features or bug fixes
- Make sure all tests pass and linting checks are successful
- Be responsive to feedback and questions

## Writing Documentation

- Use JSDoc comments for all public API methods, classes, and components
- Follow existing documentation patterns
- Include examples for complex functionality
- Update README files when adding new features

## Coding Standards

### General Guidelines

- Follow the existing code style of the project
- Use TypeScript for type safety
- Write self-documenting code with clear variable/function names
- Add comments for complex logic, but prefer readable code over excessive comments
- Keep functions small and focused on a single responsibility

### Frontend Guidelines

- Follow Vue.js best practices
- Use composition API for new components
- Keep components small and reusable
- Use SCSS for styling with the existing variable system

### Backend Guidelines

- Maintain clear domain boundaries
- Follow the service pattern for business logic
- Document API endpoints with JSDoc comments

## Tests & Linting

- Add tests for all new features and bug fixes
- Make sure all tests pass before submitting: `npm run test`
- Make sure testing coverage stays at or above 80%, or if the project is not yet to 80%, that it moves positively in that direction: `npm run test:coverage`
- Ensure code passes linting checks: `npm run lint`
- Follow existing testing patterns

## Federation Implementation

When working on federation features:
- Follow ActivityPub and WebFinger specifications
- Consider security implications of federated features

## Accessibility

All contributions should maintain or improve accessibility:
- Ensure screen reader compatibility
- Support keyboard navigation
- Maintain color contrast requirements
- Test multilingual support
