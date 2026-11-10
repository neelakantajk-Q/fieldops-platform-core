/**
 * Financial year closing: archives the active partitions and initialises the
 * next year. Administrator only, and never deletes the archived rows.
 */

var FY_TABLES = ['Attendance', 'Tasks', 'Vehicles', 'Captures', 'Telemetry', 'AuditLogs'];

function runFinancialClosing_(ctx, payload) {
  requireAdmin_(ctx);
  var current = fiscalYear_(payload.currentFY || activeFy_());
  var next = fiscalYear_(payload.nextFY || nextFiscalYear_(current));
  if (current === next) throw appError_(CODES.VALIDATION, 'Current and next financial year must differ.');

  var ss = getPrimaryStore();
  var archived = [];

  withLock_(function () {
    FY_TABLES.forEach(function (base) {
      var sheet = ss.getSheetByName(base + '_' + current);
      if (!sheet) return;
      var archiveName = base + '_Archived_' + current;
      var existing = ss.getSheetByName(archiveName);
      if (existing) archiveName = archiveName + '_' + Utilities.getUuid().slice(0, 4);
      sheet.setName(archiveName);
      archived.push({ base: base, archivedAs: archiveName });
    });
    FY_TABLES.forEach(function (base) { fySheet_(base, next); });
    setSetting_('CurrentFY', next);
    invalidateSettingsCache_();
  });

  writeAudit_(ctx, 'FinancialClosing', current + ' -> ' + next, true);
  return {
    currentFY: current,
    nextFY: next,
    archived: archived,
    activeTables: FY_TABLES.map(function (base) { return base + '_' + next; })
  };
}

function nextFiscalYear_(fy) {
  var year = Number(String(fy).replace('FY', ''));
  return 'FY' + (year + 1);
}
