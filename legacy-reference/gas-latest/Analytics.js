/**
 * Scoped reporting: KPIs are computed from the rows the caller is allowed to
 * see, never from the full table with the remainder hidden by the client.
 */

function getAnalyticsData_(ctx) {
  var tasks = readSheet_(fySheet_('Tasks', ctx.fy));
  var attendance = readSheet_(fySheet_('Attendance', ctx.fy));

  var totalTasks = 0;
  var completedTasks = 0;
  var openTasks = 0;
  var delayedTasks = 0;
  var turnaroundTotal = 0;
  var hubWorkload = {};
  var engineerProductivity = {};
  var vehicleCount = {};

  for (var i = 0; i < tasks.rows.length; i++) {
    var row = tasks.rows[i];
    if (!String(sheetPlain_(cell_(tasks, row, 'JobId')))) continue;
    var owner = cell_(tasks, row, 'AssignedUserId');
    var hub = String(sheetPlain_(cell_(tasks, row, 'Hub')) || 'Unassigned');
    if (!canSeeRow_(ctx, owner, hub)) continue;

    var status = String(sheetPlain_(cell_(tasks, row, 'Status'))).trim();
    totalTasks++;
    hubWorkload[hub] = (hubWorkload[hub] || 0) + 1;
    if (status === 'Completed') {
      completedTasks++;
      turnaroundTotal += number_(cell_(tasks, row, 'TurnaroundMinutes'), 0);
      var engineer = String(sheetPlain_(owner) || 'Unassigned');
      engineerProductivity[engineer] = (engineerProductivity[engineer] || 0) + 1;
    } else if (status === 'Delayed') {
      delayedTasks++;
      openTasks++;
    } else if (status === 'InProgress' || status === 'Interrupted') {
      openTasks++;
    }
    var plate = String(sheetPlain_(cell_(tasks, row, 'VehicleNo')) || '');
    if (plate) vehicleCount[plate] = (vehicleCount[plate] || 0) + 1;
  }

  var activeStaff = 0;
  var mockFlags = 0;
  var today = new Date().toISOString().slice(0, 10);
  for (var a = 0; a < attendance.rows.length; a++) {
    var aRow = attendance.rows[a];
    var aUser = cell_(attendance, aRow, 'UserId');
    if (!canSeeRow_(ctx, aUser, ctx.hub)) continue;
    var stamp = isoDate_(cell_(attendance, aRow, 'Timestamp'));
    if (stamp.slice(0, 10) !== today) continue;
    if (String(sheetPlain_(cell_(attendance, aRow, 'Action'))) === 'CheckIn') activeStaff++;
    if (bool_(cell_(attendance, aRow, 'MockFlag'))) mockFlags++;
  }

  return {
    analytics: {
      totalTasks: totalTasks,
      completedTasks: completedTasks,
      openTasks: openTasks,
      delayedTasks: delayedTasks,
      avgTurnaroundMinutes: completedTasks ? Math.round(turnaroundTotal / completedTasks) : 0,
      hubWorkload: hubWorkload,
      engineerProductivity: engineerProductivity,
      vehiclesTouched: Object.keys(vehicleCount).length,
      activeStaffToday: activeStaff,
      mockLocationFlags: mockFlags,
      scope: ctx.scope,
      fy: ctx.fy
    }
  };
}

function getAuditLogsList_(ctx, payload) {
  requireTenantAccess_(ctx);
  var read = readSheet_(fySheet_('AuditLogs', ctx.fy));
  var limit = Math.min(Math.max(number_(payload.limit, 100), 1), 500);
  var logs = [];
  for (var i = read.rows.length - 1; i >= 0 && logs.length < limit; i--) {
    var row = read.rows[i];
    if (!String(sheetPlain_(cell_(read, row, 'LogId')))) continue;
    var userId = String(sheetPlain_(cell_(read, row, 'UserId')) || '');
    if (ctx.scope !== 'ALL' && userId !== 'anonymous' && !canSeeRow_(ctx, userId, ctx.hub)) continue;
    logs.push({
      logId: String(sheetPlain_(cell_(read, row, 'LogId'))),
      timestamp: isoDate_(cell_(read, row, 'Timestamp')),
      userId: userId,
      activityType: String(sheetPlain_(cell_(read, row, 'ActivityType')) || ''),
      details: String(sheetPlain_(cell_(read, row, 'Details')) || ''),
      disruptionFlag: bool_(cell_(read, row, 'DisruptionFlag'))
    });
  }
  return { logs: logs };
}

/**
 * Workflow documents are filtered by MinRoleRequired server-side and the
 * commercial block is removed, not masked, for lower roles.
 */
function getWorkflowsList_(ctx) {
  var read = readSheet_(storeSheet_('Workflows', SCHEMA.Workflows));
  var docs = [];
  for (var i = 0; i < read.rows.length; i++) {
    var row = read.rows[i];
    var docId = String(sheetPlain_(cell_(read, row, 'DocId')) || '');
    if (!docId) continue;
    var minRole = String(sheetPlain_(cell_(read, row, 'MinRoleRequired')) || 'StandardUser');
    if (minRoleRank_(minRole) > ctx.roleRank) continue;
    docs.push({
      docId: docId,
      title: String(sheetPlain_(cell_(read, row, 'Title')) || ''),
      category: String(sheetPlain_(cell_(read, row, 'Category')) || ''),
      content: String(sheetPlain_(cell_(read, row, 'Content')) || ''),
      minRoleRequired: minRole,
      commercialDetails: ctx.roleRank >= 2 ? String(sheetPlain_(cell_(read, row, 'CommercialDetails')) || '') : null
    });
  }
  return { workflows: docs };
}
