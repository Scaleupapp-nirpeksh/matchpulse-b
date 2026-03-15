# MatchPulse Backend — Development Guide

## Project Overview
MatchPulse is an open tournament platform for live-scored sports tournaments.
Backend: Node.js + Express + Socket.io + MongoDB + Mongoose

## Tech Stack
- **Runtime:** Node.js 20+
- **Framework:** Express.js (REST API) + Socket.io (real-time)
- **Database:** MongoDB via Mongoose ODM
- **Auth:** JWT (access 15min + refresh 7d), Twilio OTP, email/password
- **Storage:** AWS S3 + CloudFront CDN
- **AI:** Anthropic Claude API (commentary, summaries)
- **Push:** Web Push API + APNs payloads

## Project Structure
```
src/
├── config/        # DB, env, S3, socket config
├── models/        # Mongoose schemas (11 collections)
├── middleware/     # Auth, RBAC, audit, error handler, rate limiter
├── routes/        # Express route definitions
├── controllers/   # Request handlers
├── services/      # Business logic (auth, OTP, fixtures, AI, etc.)
├── scoring/       # Sport-specific scoring engines (9 sports)
├── socket/        # Socket.io setup and event handlers
├── utils/         # Errors, helpers, constants
├── validators/    # express-validator request validation
├── server.js      # Entry point
└── app.js         # Express app setup
```

## Commands
- `npm run dev` — Start with nodemon (development)
- `npm start` — Start production server
- `npm test` — Run tests
- `npm run lint` — Lint code

## Architecture Patterns
- **MVC + Services:** Routes → Controllers → Services → Models
- **Scoring Engines:** Each sport has a dedicated engine extending BaseScoringEngine
- **Audit Trail:** Every mutation is logged via audit middleware (append-only)
- **Role-Based Access:** 5-tier RBAC (Platform Admin, Org Admin, Tournament Admin, Scorer, Player)
- **Real-time:** Socket.io rooms per match/tournament/org

## Supported Sports
Cricket, Football, Basketball 5v5, Basketball 3x3, Volleyball, Tennis, Table Tennis, Badminton, Squash

## Key Conventions
- All timestamps in UTC
- Soft deletes via `isUndone` flag on scoring events (never hard delete)
- Audit log is append-only — no updates or deletes
- Spectator endpoints are public (no auth required)
- All admin/scorer endpoints require JWT + role check
