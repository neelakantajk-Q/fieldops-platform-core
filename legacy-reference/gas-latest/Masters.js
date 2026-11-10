/**
 * Master data: regions (free text list), hubs (name + coordinates + radius)
 * and client sites (hub + coordinates) that technicians are allotted to.
 *
 * Administrators add a line at a time from the portal's plus control; every
 * line is validated against its parent before it is stored.
 */

function regionsSheet_() { return storeSheet_('Regions', SCHEMA.Regions); }
function hubsSheet_() { return storeSheet_('Hubs', SCHEMA.Hubs); }
function clientsSheet_() { return storeSheet_('Clients', SCHEMA.Clients); }

var hubRegionRuntimeCache_ = null;

function hubRegion_(hubName) {
  var name = String(hubName || '').trim();
  if (!name) return '';
  if (!hubRegionRuntimeCache_) {
    hubRegionRuntimeCache_ = {};
    try {
      var read = readSheet_(hubsSheet_());
      for (var i = 0; i < read.rows.length; i++) {
        var hub = String(sheetPlain_(cell_(read, read.rows[i], 'Name'))).trim();
        if (hub) hubRegionRuntimeCache_[hub] = String(sheetPlain_(cell_(read, read.rows[i], 'Region')) || '').trim();
      }
    } catch (e) {
      hubRegionRuntimeCache_ = {};
    }
  }
  return hubRegionRuntimeCache_[name] || '';
}

function resetMasterCaches_() {
  hubRegionRuntimeCache_ = null;
}

/* ------------------------------------------------------------------ read */

function listRegions_() {
  var read = readSheet_(regionsSheet_());
  var out = [];
  for (var i = 0; i < read.rows.length; i++) {
    var name = String(sheetPlain_(cell_(read, read.rows[i], 'Name')) || '').trim();
    if (!name) continue;
    out.push({
      regionId: String(sheetPlain_(cell_(read, read.rows[i], 'RegionId'))),
      name: name,
      notes: String(sheetPlain_(cell_(read, read.rows[i], 'Notes')) || ''),
      active: bool_(valueOr_(read, read.rows[i], 'Active', 'true'))
    });
  }
  out.sort(function (a, b) { return a.name.localeCompare(b.name); });
  return out;
}

function listHubs_() {
  var read = readSheet_(hubsSheet_());
  var out = [];
  for (var i = 0; i < read.rows.length; i++) {
    var row = read.rows[i];
    var name = String(sheetPlain_(cell_(read, row, 'Name')) || '').trim();
    if (!name) continue;
    out.push({
      hubId: String(sheetPlain_(cell_(read, row, 'HubId'))),
      name: name,
      region: String(sheetPlain_(cell_(read, row, 'Region')) || ''),
      lat: number_(cell_(read, row, 'Lat'), 0),
      lng: number_(cell_(read, row, 'Lng'), 0),
      radiusMeters: number_(cell_(read, row, 'RadiusMeters'), 300),
      active: bool_(valueOr_(read, row, 'Active', 'true'))
    });
  }
  out.sort(function (a, b) { return a.name.localeCompare(b.name); });
  return out;
}

function listClients_() {
  var read = readSheet_(clientsSheet_());
  var out = [];
  for (var i = 0; i < read.rows.length; i++) {
    var row = read.rows[i];
    var name = String(sheetPlain_(cell_(read, row, 'Name')) || '').trim();
    if (!name) continue;
    out.push({
      clientId: String(sheetPlain_(cell_(read, row, 'ClientId'))),
      name: name,
      hubId: String(sheetPlain_(cell_(read, row, 'HubId')) || ''),
      region: String(sheetPlain_(cell_(read, row, 'Region')) || ''),
      address: String(sheetPlain_(cell_(read, row, 'Address')) || ''),
      lat: number_(cell_(read, row, 'Lat'), 0),
      lng: number_(cell_(read, row, 'Lng'), 0),
      contactName: String(sheetPlain_(cell_(read, row, 'ContactName')) || ''),
      contactPhone: String(sheetPlain_(cell_(read, row, 'ContactPhone')) || ''),
      active: bool_(valueOr_(read, row, 'Active', 'true'))
    });
  }
  out.sort(function (a, b) { return a.name.localeCompare(b.name); });
  return out;
}

function mastersList_(ctx) {
  return {
    regions: listRegions_(),
    hubs: listHubs_(),
    clients: listClients_(),
    canEdit: ctx.platform || ctx.roleRank >= 4
  };
}

/* ----------------------------------------------------------------- write */

function nextMasterId_(read, prefix, field) {
  var max = 0;
  var index = col_(read, field);
  for (var i = 0; i < read.rows.length; i++) {
    var value = String(sheetPlain_(read.rows[i][index]) || '');
    var match = /(\d+)$/.exec(value);
    if (match) max = Math.max(max, Number(match[1]));
  }
  var next = max + 1;
  return prefix + ('0000' + next).slice(-4);
}

function requireMasterEditor_(ctx) {
  if (!ctx.platform && ctx.roleRank < 4) {
    throw appError_(CODES.FORBIDDEN, 'Only an administrator can change master data.');
  }
}

function coordinate_(label, value, limit) {
  var parsed = number_(value, NaN);
  if (!isFinite(parsed) || Math.abs(parsed) > limit) {
    throw appError_(CODES.VALIDATION, label + ' is not a valid coordinate.');
  }
  return parsed;
}

/** One line at a time: kind = region | hub | client. */
function masterCreate_(ctx, payload) {
  requireMasterEditor_(ctx);
  var kind = text_(payload.kind, 16, true).toLowerCase();
  var now = new Date();

  if (kind === 'region') {
    var read = readSheet_(regionsSheet_());
    var name = text_(payload.name, 60, true);
    for (var i = 0; i < read.rows.length; i++) {
      if (String(sheetPlain_(cell_(read, read.rows[i], 'Name'))).toLowerCase() === name.toLowerCase()) {
        throw appError_(CODES.CONFLICT, 'That region already exists.');
      }
    }
    var regionId = nextMasterId_(read, 'REG-', 'RegionId');
    withLock_(function () {
      appendObject_(read, {
        RegionId: regionId, Name: name, Notes: text_(payload.notes, 200), Active: 'true',
        CreatedAt: now, CreatedBy: ctx.userId, UpdatedAt: now, UpdatedBy: ctx.userId
      });
    });
    resetMasterCaches_();
    writeAudit_(ctx, 'MasterRegionAdded', name, false);
    return { kind: 'region', region: { regionId: regionId, name: name, notes: text_(payload.notes, 200), active: true } };
  }

  if (kind === 'hub') {
    var region = text_(payload.region, 60, true);
    if (!regionExists_(region)) throw appError_(CODES.VALIDATION, 'Select an existing region first.');
    var hubRead = readSheet_(hubsSheet_());
    var hubName = text_(payload.name, 80, true);
    for (var h = 0; h < hubRead.rows.length; h++) {
      if (String(sheetPlain_(cell_(hubRead, hubRead.rows[h], 'Name'))).toLowerCase() === hubName.toLowerCase()) {
        throw appError_(CODES.CONFLICT, 'That hub already exists.');
      }
    }
    var hubId = nextMasterId_(hubRead, 'HUB-', 'HubId');
    var hub = {
      HubId: hubId, Name: hubName, Region: region,
      Lat: coordinate_('Latitude', payload.lat, 90),
      Lng: coordinate_('Longitude', payload.lng, 180),
      RadiusMeters: Math.max(50, number_(payload.radiusMeters, 300)),
      Active: 'true', CreatedAt: now, CreatedBy: ctx.userId, UpdatedAt: now, UpdatedBy: ctx.userId
    };
    withLock_(function () { appendObject_(hubRead, hub); });
    resetMasterCaches_();
    writeAudit_(ctx, 'MasterHubAdded', hubName + ' (' + region + ')', false);
    return {
      kind: 'hub',
      hub: {
        hubId: hubId, name: hubName, region: region, lat: hub.Lat, lng: hub.Lng,
        radiusMeters: hub.RadiusMeters, active: true
      }
    };
  }

  if (kind === 'client') {
    var clientRead = readSheet_(clientsSheet_());
    var clientName = text_(payload.name, 120, true);
    var hubIdInput = text_(payload.hubId, 24);
    var hubRecord = findHub_(hubIdInput);
    if (!hubRecord) throw appError_(CODES.VALIDATION, 'Select an existing hub for this site.');
    var clientId = nextMasterId_(clientRead, 'CLI-', 'ClientId');
    var client = {
      ClientId: clientId,
      Name: clientName,
      HubId: hubRecord.hubId,
      Region: hubRecord.region,
      Address: text_(payload.address, 200),
      Lat: coordinate_('Latitude', payload.lat, 90),
      Lng: coordinate_('Longitude', payload.lng, 180),
      ContactName: text_(payload.contactName, 80),
      ContactPhone: text_(payload.contactPhone, 24),
      Active: 'true', CreatedAt: now, CreatedBy: ctx.userId, UpdatedAt: now, UpdatedBy: ctx.userId
    };
    withLock_(function () { appendObject_(clientRead, client); });
    writeAudit_(ctx, 'MasterClientAdded', clientName + ' @ ' + hubRecord.name, false);
    return { kind: 'client', client: clientToJson_(client) };
  }

  throw appError_(CODES.VALIDATION, 'Unknown master type.');
}

function regionExists_(name) {
  var regions = listRegions_();
  for (var i = 0; i < regions.length; i++) {
    if (regions[i].name.toLowerCase() === String(name).toLowerCase()) return true;
  }
  return false;
}

function findHub_(hubId) {
  var hubs = listHubs_();
  for (var i = 0; i < hubs.length; i++) {
    if (hubs[i].hubId === hubId || hubs[i].name === hubId) return hubs[i];
  }
  return null;
}

function findClient_(clientId) {
  var clients = listClients_();
  for (var i = 0; i < clients.length; i++) {
    if (clients[i].clientId === clientId || clients[i].name === clientId) return clients[i];
  }
  return null;
}

function clientToJson_(client) {
  return {
    clientId: client.ClientId || client.clientId,
    name: client.Name || client.name,
    hubId: client.HubId || client.hubId,
    region: client.Region || client.region || '',
    address: client.Address || client.address || '',
    lat: number_(client.Lat !== undefined ? client.Lat : client.lat, 0),
    lng: number_(client.Lng !== undefined ? client.Lng : client.lng, 0),
    contactName: client.ContactName || client.contactName || '',
    contactPhone: client.ContactPhone || client.contactPhone || '',
    active: client.Active === undefined ? Boolean(client.active) : bool_(client.Active)
  };
}

/** Inline cell edit from the master table (one field at a time). */
function masterUpdate_(ctx, payload) {
  requireMasterEditor_(ctx);
  var kind = text_(payload.kind, 16, true).toLowerCase();
  var id = text_(payload.id, 30, true);
  var field = text_(payload.field, 30, true);
  var value = payload.value;

  var sheet;
  var idColumn;
  var allowed;
  if (kind === 'region') {
    sheet = regionsSheet_(); idColumn = 'RegionId';
    allowed = { name: 'Name', notes: 'Notes', active: 'Active' };
  } else if (kind === 'hub') {
    sheet = hubsSheet_(); idColumn = 'HubId';
    allowed = { name: 'Name', region: 'Region', lat: 'Lat', lng: 'Lng', radiusMeters: 'RadiusMeters', active: 'Active' };
  } else if (kind === 'client') {
    sheet = clientsSheet_(); idColumn = 'ClientId';
    allowed = {
      name: 'Name', hubId: 'HubId', address: 'Address', lat: 'Lat', lng: 'Lng',
      contactName: 'ContactName', contactPhone: 'ContactPhone', active: 'Active'
    };
  } else {
    throw appError_(CODES.VALIDATION, 'Unknown master type.');
  }

  var column = allowed[field];
  if (!column) throw appError_(CODES.VALIDATION, 'That field cannot be edited here.');

  var read = readSheet_(sheet);
  var index = col_(read, idColumn);
  var rowIndex = -1;
  for (var i = 0; i < read.rows.length; i++) {
    if (String(sheetPlain_(read.rows[i][index])) === id) { rowIndex = i; break; }
  }
  if (rowIndex < 0) throw appError_(CODES.NOT_FOUND, 'Master line not found.');

  var stored;
  if (field === 'lat') stored = coordinate_('Latitude', value, 90);
  else if (field === 'lng') stored = coordinate_('Longitude', value, 180);
  else if (field === 'radiusMeters') stored = Math.max(50, number_(value, 300));
  else if (field === 'active') stored = boolText_(bool_(value));
  else if (field === 'region') {
    if (!regionExists_(text_(value, 60, true))) throw appError_(CODES.VALIDATION, 'Unknown region.');
    stored = text_(value, 60);
  } else if (field === 'hubId') {
    var hub = findHub_(text_(value, 24, true));
    if (!hub) throw appError_(CODES.VALIDATION, 'Unknown hub.');
    stored = hub.hubId;
  } else stored = text_(value, field === 'address' ? 200 : 120);

  var changes = {};
  changes[column] = stored;
  changes.UpdatedAt = new Date();
  changes.UpdatedBy = ctx.userId;
  if (kind === 'client' && field === 'hubId') {
    var selected = findHub_(stored);
    if (selected) changes.Region = selected.region;
  }

  withLock_(function () { updateRow_(read, rowIndex + 2, changes); });
  resetMasterCaches_();
  writeAudit_(ctx, 'MasterUpdated', kind + ' ' + id + ' ' + field, false);
  return { updated: true, kind: kind, id: id, field: field };
}

function masterArchive_(ctx, payload) {
  requireMasterEditor_(ctx);
  var kind = text_(payload.kind, 16, true).toLowerCase();
  var id = text_(payload.id, 30, true);
  var sheet = kind === 'region' ? regionsSheet_() : (kind === 'hub' ? hubsSheet_() : clientsSheet_());
  var idColumn = kind === 'region' ? 'RegionId' : (kind === 'hub' ? 'HubId' : 'ClientId');
  var read = readSheet_(sheet);
  var index = col_(read, idColumn);
  for (var i = 0; i < read.rows.length; i++) {
    if (String(sheetPlain_(read.rows[i][index])) !== id) continue;
    withLock_(function () {
      updateRow_(read, i + 2, { Active: 'false', UpdatedAt: new Date(), UpdatedBy: ctx.userId });
    });
    resetMasterCaches_();
    writeAudit_(ctx, 'MasterArchived', kind + ' ' + id, true);
    return { archived: true, kind: kind, id: id };
  }
  throw appError_(CODES.NOT_FOUND, 'Master line not found.');
}
