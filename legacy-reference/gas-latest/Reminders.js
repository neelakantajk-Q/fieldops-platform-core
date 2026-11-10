/**
 * Private reminder (to-do) service. Rows are owned by the signed-in user;
 * every change is logged for audit.
 */

function reminderHeaders_() { return SCHEMA.ToDoReminders; }
function reminderLogHeaders_() { return SCHEMA.ToDoReminderLogs; }

function reminderText_(value, max, required) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
    throw appError_(CODES.VALIDATION, 'Invalid reminder text.');
  }
  return value;
}

function reminderDate_(value) {
  if (value === '' || value === undefined || value === null) return '';
  if (typeof value !== 'string') throw appError_(CODES.VALIDATION, 'Invalid reminder date.');
  var parsed = new Date(value);
  if (isNaN(parsed.getTime())) throw appError_(CODES.VALIDATION, 'Invalid reminder date.');
  return parsed.toISOString();
}

function reminderRecord_(row, read) {
  function stamp(value) {
    return value instanceof Date ? value.toISOString() : String(value || '');
  }
  return {
    id: String(sheetPlain_(cell_(read, row, 'ReminderId'))),
    userId: String(sheetPlain_(cell_(read, row, 'UserId')) || ''),
    username: String(sheetPlain_(cell_(read, row, 'Username')) || ''),
    title: String(sheetPlain_(cell_(read, row, 'Title')) || ''),
    note: String(sheetPlain_(cell_(read, row, 'Note')) || ''),
    reminderAt: stamp(cell_(read, row, 'ReminderAt')),
    status: String(sheetPlain_(cell_(read, row, 'Status')) || 'Pending'),
    createdAt: stamp(cell_(read, row, 'CreatedAt')),
    updatedAt: stamp(cell_(read, row, 'UpdatedAt'))
  };
}

function getReminders_(ctx) {
  requireTenantOrSupervisor_(ctx);
  var read = readSheet_(storeSheet_('ToDoReminders', reminderHeaders_()));
  var reminders = [];
  for (var i = 0; i < read.rows.length; i++) {
    var row = read.rows[i];
    if (String(sheetPlain_(cell_(read, row, 'UserId'))) !== ctx.userId) continue;
    reminders.push(reminderRecord_(row, read));
  }
  reminders.sort(function (a, b) {
    return ((a.status === 'Pending' ? 0 : 1) - (b.status === 'Pending' ? 0 : 1)) ||
      String(a.reminderAt || '9999').localeCompare(String(b.reminderAt || '9999')) ||
      a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
  });
  return { reminders: reminders };
}

/** Reminders are a supervisor/administrator tool, matching the portal gate. */
function requireTenantOrSupervisor_(ctx) {
  if (ctx.roleRank < 2) throw appError_(CODES.FORBIDDEN, 'Reminder access requires supervisor rights.');
}

function saveReminder_(ctx, payload) {
  requireTenantOrSupervisor_(ctx);
  var id = isUuid_(payload.requestId) ? String(payload.requestId).toLowerCase() : '';
  if (!id) throw appError_(CODES.VALIDATION, 'A UUID request ID is required.');

  var title = reminderText_(payload.title, 160, true);
  var note = reminderText_(payload.note === undefined ? '' : String(payload.note), 2000, false);
  var reminderAt = reminderDate_(payload.reminderAt === undefined ? '' : String(payload.reminderAt));

  var sheet = storeSheet_('ToDoReminders', reminderHeaders_());
  var read = readSheet_(sheet);
  for (var i = 0; i < read.rows.length; i++) {
    if (String(sheetPlain_(cell_(read, read.rows[i], 'ReminderId'))).toLowerCase() !== id) continue;
    if (String(sheetPlain_(cell_(read, read.rows[i], 'UserId'))) !== ctx.userId) {
      throw appError_(CODES.NOT_FOUND, 'Reminder not found.');
    }
    return { reminder: reminderRecord_(read.rows[i], read), duplicate: true };
  }

  var now = new Date();
  var record = {
    ReminderId: id,
    UserId: ctx.userId,
    Username: ctx.username,
    Title: title,
    Note: note,
    ReminderAt: reminderAt,
    Status: 'Pending',
    CreatedAt: now,
    UpdatedAt: now
  };
  withLock_(function () {
    appendObject_(read, record);
    logReminder_(ctx, id, 'Created', note);
  });
  writeAudit_(ctx, 'ReminderCreated', title, false);

  var after = readSheet_(sheet);
  for (var j = 0; j < after.rows.length; j++) {
    if (String(sheetPlain_(cell_(after, after.rows[j], 'ReminderId'))) === id) {
      return { reminder: reminderRecord_(after.rows[j], after) };
    }
  }
  throw appError_(CODES.INTERNAL, 'Reminder could not be stored.');
}

function updateReminderStatus_(ctx, payload) {
  requireTenantOrSupervisor_(ctx);
  var id = text_(payload.reminderId || payload.id, 40, true).toLowerCase();
  var status = text_(payload.status, 16, true);
  if (status !== 'Pending' && status !== 'Completed') throw appError_(CODES.VALIDATION, 'Invalid status.');

  var sheet = storeSheet_('ToDoReminders', reminderHeaders_());
  var read = readSheet_(sheet);
  for (var i = 0; i < read.rows.length; i++) {
    var row = read.rows[i];
    if (String(sheetPlain_(cell_(read, row, 'ReminderId'))).toLowerCase() !== id) continue;
    if (String(sheetPlain_(cell_(read, row, 'UserId'))) !== ctx.userId) {
      throw appError_(CODES.NOT_FOUND, 'Reminder not found.');
    }
    var changes = { Status: status, UpdatedAt: new Date() };
    var changesLog = [];
    if (String(sheetPlain_(cell_(read, row, 'Status'))) !== status) changesLog.push(['StatusChanged', status]);
    if (payload.note !== undefined) {
      var note = reminderText_(String(payload.note), 2000, false);
      changes.Note = note;
      changesLog.push(['NoteChanged', note]);
    }
    withLock_(function () {
      updateRow_(read, i + 2, changes);
      changesLog.forEach(function (entry) { logReminder_(ctx, id, entry[0], entry[1]); });
    });
    writeAudit_(ctx, 'ReminderUpdated', id + ' -> ' + status, false);
    var after = readSheet_(sheet);
    for (var j = 0; j < after.rows.length; j++) {
      if (String(sheetPlain_(cell_(after, after.rows[j], 'ReminderId'))).toLowerCase() === id) {
        return { reminder: reminderRecord_(after.rows[j], after) };
      }
    }
    return { reminder: reminderRecord_(row, read) };
  }
  throw appError_(CODES.NOT_FOUND, 'Reminder not found.');
}

function logReminder_(ctx, reminderId, action, note) {
  try {
    var read = readSheet_(storeSheet_('ToDoReminderLogs', reminderLogHeaders_()));
    appendObject_(read, {
      LogId: Utilities.getUuid(),
      ReminderId: reminderId,
      UserId: ctx.userId,
      Username: ctx.username,
      Action: String(action).slice(0, 40),
      Note: String(note === undefined ? '' : note).slice(0, 2000),
      Timestamp: new Date()
    });
  } catch (e) {
    console.error('reminder log failure: ' + (e && e.message));
  }
}
