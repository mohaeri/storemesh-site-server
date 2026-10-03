import { randomUUID } from 'node:crypto';

const DEFAULT_MACHINES = {
  FREEZE: ['F-1', 'FREEZER-01', 'FREEZER-1', 'freezer-1', 'M-FREEZE', 'M-2'],
  FREEZE_DRY: ['FD-01', 'FD-1', 'M-FREEZE_DRY'],
  DRY: ['D-1', 'DRYER-01', 'DRYER-1', 'dryer', 'M-DRY'],
};

export function activateTestStationMachines(app) {
  if (app.state.configurationVersions.some(item => item.scope === 'STATION_MACHINES' && item.status === 'ACTIVE')) return;
  const stations = Object.fromEntries(
    [...new Set(app.state.sessions.map(session => session.station))].map(station => [station, DEFAULT_MACHINES]),
  );
  const version = app.createConfiguration(
    { scope: 'STATION_MACHINES', values: { stations }, userId: 'test-machine-author' },
    randomUUID(),
  );
  app.transitionConfiguration(version.id, 'APPROVE', 'test-machine-approver', randomUUID());
  app.transitionConfiguration(version.id, 'ACTIVATE', 'test-machine-approver', randomUUID());
}

export function createTestCycle(app, input, key) {
  activateTestStationMachines(app);
  return app.createCycle(input, key);
}

