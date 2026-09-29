---
name: ak-backend-development
description: Build backends with Node.js, Python, Go (NestJS, FastAPI, Django). Use for REST/GraphQL/gRPC APIs, auth (OAuth, JWT), databases, microservices, security (OWASP), Docker/K8s.
user-invocable: true
when_to_use: "Invoke when backend/API implementation is the main surface."
category: engineering
keywords: [nodejs, python, go, api, rest, graphql]
license: MIT
argument-hint: "[framework] [task]"
metadata:
  author: agentkit
  version: "1.0.1"
---

# Backend development

Build the requested API/backend behavior using the project's actual stack and conventions.
Inspect manifests, route/service boundaries, data ownership and tests before selecting a
framework or recipe. A REST endpoint fix does not authorize replacing auth or the database.

Match the change: API design, authentication integration, performance, architecture, testing
or deployment. Open the corresponding reference below; specialized database/auth/deployment
skills own work whose primary intent is that domain. New backend choices need constraints
and trade-offs. Verify version-sensitive guidance with the installed dependency and official
docs; no performance percentage in a recipe is evidence for this application.

Validate input, preserve server-owned authorization/state, expose stable errors, and verify
success/failure paths plus affected caller contracts. Broad implementation checklists live in
`references/implementation-checklist.md` and apply only to affected features.

## Reference Navigation

**Core Technologies:**
- `backend-technologies.md` - Languages, frameworks, databases, message queues, ORMs
- `backend-api-design.md` - REST, GraphQL, gRPC patterns and best practices

**Security & Authentication:**
- `backend-security.md` - OWASP Top 10 2025, security best practices, input validation
- `backend-authentication.md` - OAuth 2.1, JWT, RBAC, MFA, session management

**Performance & Architecture:**
- `backend-performance.md` - Caching, query optimization, load balancing, scaling
- `backend-architecture.md` - Microservices, event-driven, CQRS, saga patterns

**Quality & Operations:**
- `backend-testing.md` - Testing strategies, frameworks, tools, CI/CD testing
- `backend-code-quality.md` - SOLID principles, design patterns, clean code
- `backend-devops.md` - Docker, Kubernetes, deployment strategies, monitoring
- `backend-debugging.md` - Debugging strategies, profiling, logging, production debugging
- `backend-mindset.md` - Problem-solving, architectural thinking, collaboration
