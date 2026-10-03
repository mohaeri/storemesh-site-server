# StoreMesh 100-scenario system verification

Automated by `test/system-100-scenarios.test.js`. Every scenario has a stable `SC-NNN` identifier and an isolated application state.

| Range | Area | Verification |
|---|---|---|
| SC-001–010 | Devices | Registration, station assignment, heartbeat, online presence |
| SC-011–020 | Sessions and roles | All ten station roles, device attribution, active session audit |
| SC-021–030 | Receiving | Physical basket assignment, permanent measurement, weight and device provenance |
| SC-031–040 | Containers | Capacity overflow rejection and atomic rollback |
| SC-041–050 | Production | Merge genealogy, mass conservation, non-negative inventory, audit |
| SC-051–060 | Packaging success | Dedicated packaging session and ten within-tolerance UNIT weights |
| SC-061–070 | Packaging rejection | Ten outside-tolerance weights and atomic inventory protection |
| SC-071–080 | Tasks | Negative and positive eligibility checks for every station role |
| SC-081–090 | Exceptions | Open, assign, resolve, timestamps, and audit across all severities |
| SC-091–100 | Customer shipping | Customer/order/carton, picking, scan gate, vehicle, six-state lifecycle |

The scenarios supplement—not replace—the repository's security, HTTP, PostgreSQL, property, state-machine, and client suites.
