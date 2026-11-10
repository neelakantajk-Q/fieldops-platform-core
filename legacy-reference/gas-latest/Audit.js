/**
 * Audit trail. Every mutation records who did what, in the same fiscal-year
 * partition as the data it touched.
 */

function writeAudit_(ctx, activityType, details, disruption) {
  try {
    var fy = ctx && ctx.fy ? ctx.fy : activeFy_();
    var read = readSheet_(fySheet_('AuditLogs', fy));
    appendObject_(read, {
      LogId: 'LOG-' + Utilities.getUuid().slice(0, 8).toUpperCase(),
      Timestamp: new Date(),
      UserId: ctx && ctx.userId ? ctx.userId : 'anonymous',
      ActivityType: text_(activityType, 60, true),
      Details: text_(details, 500),
      DisruptionFlag: boolText_(disruption)
    });
  } catch (e) {
    console.error('audit failure: ' + (e && e.message));
  }
}

function auditAccessDenied_(action, ctx, reason) {
  writeAudit_(ctx, 'AccessDenied', action + ' :: ' + (reason || 'forbidden'), true);
}

/**
 * Records a client-supplied identity that does not match the session so that
 * privilege-escalation attempts are visible in the audit table.
 */
function auditIdentityMismatch_(ctx, action, claimedField, claimedValue) {
  writeAudit_(ctx, 'PrivilegeAttempt',
    action + ' claimed ' + claimedField + '=' + String(claimedValue).slice(0, 60), true);
}

/**
 * If a request repeats a session-resolved field (userId, role, hub, adminUser)
 * with a different value, treat it as tampering and refuse the request.
 */
function assertNoIdentityOverride_(ctx, payload, action) {
  if (!payload) return;
  var checks = [
    ['userId', ctx.userId],
    ['role', ctx.role]
  ];
  for (var i = 0; i < checks.length; i++) {
    var field = checks[i][0];
    var actual = checks[i][1];
    var claimed = payload[field];
    if (claimed === undefined || claimed === null || claimed === '') continue;
    if (String(claimed).trim().toLowerCase() !== String(actual).trim().toLowerCase()) {
      auditIdentityMismatch_(ctx, action, field, claimed);
      throw appError_(CODES.FORBIDDEN, 'Request identity does not match the active session.');
    }
  }
}
