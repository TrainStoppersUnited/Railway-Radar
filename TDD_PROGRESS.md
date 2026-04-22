# TDD Progress Tracker

## Objectives
Address critical architectural issues using Test-Driven Development (Red/Green cycle).

## 🚀 Backlog (Critical Issues)
- [x] **Input Validation:** API endpoints lack query validation.
- [x] **Station Database Duplication:** Unify station data across frontend and backend.
- [x] **Database Persistence:** Add history/data storage.
- [ ] **WebSockets:** Implement true real-time updates (replace polling).
- [ ] **Error Recovery:** Implement fallbacks for S3 API failures.

## 🏃 Current Task
- Next task: Implement WebSockets or Error Recovery.

## 📝 Work Log
* **2026-04-15:** Created TDD progress tracking file.
* **2026-04-15:** Implemented express-validator for `/api/trains` input validation. Wrote `api.test.js` to ensure improper 3-character format returns `400 Bad Request`. 
* **2026-04-15:** Fixed `/api/stations` returning nested `{ stations }` object to return simple JSON array instead. Refactored `app.js` to dynamically fetch stations from the API via `loadStations()` during `DOMContentLoaded`, eliminating code duplication. Tests passing.
* **2026-04-15:** Integrated `better-sqlite3`. Setup `db.js` wrapper handling synchronous database initialization and insertion. Created strict TDD tests confirming it efficiently stores historical data on updates. Connected `server.js` to persist queried trains on every S3 fetch asynchronously.
