# Railway Radar - Agent Judges Assessment

## Project Goals (from user)
1. Create a website.
2. The website should have an interactive map.
3. The map should show the live location of trains in the UK.
4. The website should run on a mobile device.
5. The app should ask for location access and zoom in on the users location.
6. Add a search bar so people can search for stations and trains.
7. Create an archive of railway workings from the last few years.
8. Add limited Google ads to the website.

---

## Agent 1 - Goal Coverage Judge

**Assessment (quality and goal alignment):**
- Core features are implemented: interactive map, live train markers, geolocation/zoom, and search.
- Mobile support exists via responsive CSS, but it is unverified and may need polish.
- Archive and ads are present only as placeholders (non-functional).
- Live updates are polling-based; not true real-time.

**Suggested improvements:**
- Implement real archive storage and API endpoints; replace mock data.
- Integrate real AdSense script and validate policy compliance.
- Improve mobile UX (map height, touch targets, layout on small screens).
- Add real-time updates via WebSocket or server-sent events.

---

## Agent 2 - UX and Mobile Judge

**Assessment (quality and usability):**
- Good baseline: semantic HTML, responsive breakpoints, and readable UI.
- Accessibility gaps: limited focus states, missing ARIA labels, no modal keyboard support.
- Mobile experience is adequate but needs size and layout tuning.

**Suggested improvements:**
- Add focus styles and keyboard handling for the archive modal (Escape to close).
- Add `aria-label` to map and key controls.
- Reduce map height on small screens (e.g., 300px at 480px).
- Improve empty and error states to guide users.
- Convert train list to a semantic list for accessibility.

---

## Agent 3 - Data and Backend Judge

**Assessment (quality and data reliability):**
- Live data comes from Darwin timetables and optional Push Port Kafka feed.
- Positioning is interpolated and not GPS-accurate.
- Reliability risks: S3 single point of failure, no persistent cache, no retry logic.
- Archive is not feasible without a database and storage pipeline.

**Suggested improvements:**
- Add S3 retry/backoff and fall back to last known data on failure.
- Add compression middleware for faster payload delivery.
- Validate train records before responding (bounds checking, required fields).
- Add a database for historical snapshots and archive queries.
- Add Kafka reconnect logic if Push Port is enabled.

---

## Agent 4 - Archive and Ads Judge

**Assessment (quality and completeness):**
- Archive feature is a stub with hardcoded sample rows.
- AdSense is a placeholder and commented out.

**Suggested improvements:**
- Decide whether to ship archive now or mark it "Coming Soon"; remove stub if not ready.
- Build archive data ingestion (periodic snapshots) and retrieval endpoints.
- Replace AdSense placeholders with real publisher IDs and test rendering.
- Add ad fallback handling to avoid layout shifts if ads are blocked.

---

## Combined Verdict

**Quality rating:** Functional MVP with strong core features, but incomplete monetization and archive goals.

**Highest-impact next steps:**
1. Make archive real (database + snapshot ingestion + API endpoints).
2. Complete ad integration or remove placeholder if not ready.
3. Strengthen mobile UX and accessibility.
4. Improve reliability with retry/fallback and compression.
