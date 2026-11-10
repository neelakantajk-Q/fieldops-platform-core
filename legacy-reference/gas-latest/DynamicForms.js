/**
 * Dynamic form builder. Field definitions are filtered by MinRole on the
 * server; only administrators may publish new fields.
 */

function getFormsRegistryStore() {
  return storeSheet_('FormsRegistry', SCHEMA.FormsRegistry);
}

function getDynamicForms_(ctx) {
  var read = readSheet_(getFormsRegistryStore());
  var forms = [];
  for (var i = 0; i < read.rows.length; i++) {
    var row = read.rows[i];
    var formId = String(sheetPlain_(cell_(read, row, 'FormId')) || '');
    if (!formId) continue;
    var minRole = String(sheetPlain_(cell_(read, row, 'MinRole')) || 'StandardUser');
    if (minRoleRank_(minRole) > ctx.roleRank) continue;
    forms.push({
      formId: formId,
      formName: String(sheetPlain_(cell_(read, row, 'FormName')) || ''),
      fieldKey: String(sheetPlain_(cell_(read, row, 'FieldKey')) || ''),
      label: String(sheetPlain_(cell_(read, row, 'Label')) || ''),
      controlType: String(sheetPlain_(cell_(read, row, 'ControlType')) || 'Text'),
      validationRegex: String(sheetPlain_(cell_(read, row, 'ValidationRegex')) || '.*'),
      options: String(sheetPlain_(cell_(read, row, 'Options')) || ''),
      minRole: minRole
    });
  }
  return { forms: forms };
}

function saveDynamicField_(ctx, payload) {
  requireAdmin_(ctx);
  var fieldKey = text_(payload.fieldKey, 60, true);
  if (!/^[a-z][a-z0-9_]*$/.test(fieldKey)) {
    throw appError_(CODES.VALIDATION, 'Field key must be lower_snake_case.');
  }
  var controlType = text_(payload.controlType, 20) || 'Text';
  if (['Text', 'DDL', 'OCR', 'STT', 'QR', 'Radio', 'Number', 'Date'].indexOf(controlType) < 0) {
    throw appError_(CODES.VALIDATION, 'Unknown control type.');
  }
  var regex = text_(payload.validationRegex, 200) || '.*';
  try {
    new RegExp(regex);
  } catch (e) {
    throw appError_(CODES.VALIDATION, 'Validation regex is not valid.');
  }

  var read = readSheet_(getFormsRegistryStore());
  for (var i = 0; i < read.rows.length; i++) {
    if (String(sheetPlain_(cell_(read, read.rows[i], 'FormName'))) === text_(payload.formName, 80) &&
        String(sheetPlain_(cell_(read, read.rows[i], 'FieldKey'))) === fieldKey) {
      throw appError_(CODES.CONFLICT, 'That field key already exists on this form.');
    }
  }

  var record = {
    FormId: 'FRM-' + Utilities.getUuid().slice(0, 6).toUpperCase(),
    FormName: text_(payload.formName, 80) || 'Service Visit Form',
    FieldKey: fieldKey,
    Label: text_(payload.label, 80, true),
    ControlType: controlType,
    ValidationRegex: regex,
    Options: text_(payload.options, 300),
    MinRole: VALIDATION_ROLE_(payload.minRole)
  };
  withLock_(function () { appendObject_(read, record); });
  writeAudit_(ctx, 'FormFieldCreated', record.FormName + '.' + fieldKey, false);
  return { field: record };
}

function VALIDATION_ROLE_(value) {
  var role = text_(value, 24) || 'StandardUser';
  return ['StandardUser', 'Moderator', 'Administrator'].indexOf(role) >= 0 ? role : 'StandardUser';
}
