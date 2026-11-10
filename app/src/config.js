/**
 * FieldOps Mobile — Base configuration & whitelabeling constants.
 * Zero default template names; all branding values are override-ready.
 */
export const CONFIG = {
  // Backend base URL (white-label friendly).
  apiBaseUrl: 'https://api.yourbrand.com',
  platformName: 'FieldOps',
  productName: 'FieldOps',
  tagLine: 'Field Operations & Vehicle CAPA',
  themePrimary: '#a6ce39',
  themePrimaryDark: '#8db32b',
  version: '2.0.0',
  schemaVersion: '4',
  seatLimitDefault: 50,
  geofenceMaxAccuracyM: 25,
  geofenceDefaultRadiusM: 800,
  mockProviderBlock: true,
};

export const JOB_CODE_PREFIX = 'JC';
export const JOB_CODE_FORMAT = 'JC-YYYYMM-HUB-XXXX';
export const JOB_STATUS = {
  OPEN: 'OPEN',
  IN_PROGRESS: 'IN_PROGRESS',
  ON_HOLD: 'ON_HOLD',
  CLOSED: 'CLOSED',
  CANCELLED: 'CANCELLED',
};
export const HOLD_REASONS = {
  WAITING_FOR_SPARES: 'WAITING_FOR_SPARES',
  WAITING_APPROVAL: 'WAITING_APPROVAL',
  FACILITY_LIMITATION: 'FACILITY_LIMITATION',
};
export const ATTENDANCE_ACTIONS = {
  CHECK_IN: 'CheckIn',
  CHECK_OUT: 'CheckOut',
};
