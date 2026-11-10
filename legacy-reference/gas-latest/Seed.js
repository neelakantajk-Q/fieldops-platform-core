/**
 * One-time schema migration and optional sample data.
 * Sample rows are tagged CreatedBy = DEMO so they can be removed in one call.
 */

var SCHEMA_VERSION = '4';
var DEFAULT_LIVE_SYNC_URL = 'https://quantum-3c2e9-default-rtdb.asia-southeast1.firebasedatabase.app/';

/* Photo storage folders provisioned by the operator. */
var DEFAULT_JOB_FOLDER_ID = '1cnMESZabjlOGe-3WNqsa61-2fGHMl6-X';
var DEFAULT_ATTENDANCE_FOLDER_ID = '1ZsbA9va7e0UFqbeaX1SWQp9KNfudJJHm';
var LEGACY_ATTENDANCE_FOLDER_ID = '1oq64QsNTtq6CzFntw0-CKZocHEAU6wRB';

function ensureMigrated_() {
  try {
    if (getSetting_('SchemaVersion', '') === SCHEMA_VERSION) return;
  } catch (e) {
    return; // store not created yet
  }

  var sheet = masterSheet_();
  var read = readSheet_(sheet);
  for (var i = 0; i < read.rows.length; i++) {
    var rawRole = String(sheetPlain_(cell_(read, read.rows[i], 'Role')) || '').trim();
    if (!rawRole) continue;
    var role = normalizeRole_(rawRole);
    var changes = {};
    if (role !== rawRole) changes.Role = role;
    if (rawRole === 'SuperAdmin' && !String(sheetPlain_(cell_(read, read.rows[i], 'Capability')) || '').trim()) {
      changes.Capability = 'PLATFORM';
    }
    if (!String(sheetPlain_(cell_(read, read.rows[i], 'Scope')) || '').trim()) {
      changes.Scope = defaultScope_(role);
    }
    if (!String(sheetPlain_(cell_(read, read.rows[i], 'AllowSelfReset')) || '').trim()) {
      changes.AllowSelfReset = 'true';
    }
    if (Object.keys(changes).length) {
      try {
        updateRow_(read, i + 2, changes);
      } catch (e) {
        // schema repair adds missing columns on the next read
      }
    }
  }

  var props = PropertiesService.getScriptProperties();
  applyProofFolders_(props);
  if (!getSetting_('FirebaseDbUrl', '')) setSetting_('FirebaseDbUrl', DEFAULT_LIVE_SYNC_URL);
  setSetting_('SchemaVersion', SCHEMA_VERSION);
  if (!getSetting_('MaxUsers', '')) setSetting_('MaxUsers', '30');
  invalidateSettingsCache_();
  resetMasterCaches_();
}

/* ------------------------------------------------------------ sample data */

function seedSampleData_(ctx) {
  requireCapability_(ctx);
  var created = { regions: 0, hubs: 0, clients: 0, users: 0, jobs: 0, vehicles: 0 };
  var now = new Date();

  [['North', 'Northern service region'], ['South', 'Southern service region']].forEach(function (region) {
    if (!regionExists_(region[0])) {
      masterCreate_(ctx, { kind: 'region', name: region[0], notes: region[1] });
      created.regions++;
    }
  });

  var hubSeeds = [
    { name: 'Central Hub', region: 'North', lat: 17.5181, lng: 78.1685, radiusMeters: 800 },
    { name: 'South Hub', region: 'South', lat: 17.3850, lng: 78.4867, radiusMeters: 600 }
  ];
  hubSeeds.forEach(function (hub) {
    if (!findHub_(hub.name)) {
      masterCreate_(ctx, { kind: 'hub', name: hub.name, region: hub.region, lat: hub.lat, lng: hub.lng, radiusMeters: hub.radiusMeters });
      created.hubs++;
    }
  });

  var clientSeeds = [
    { name: 'Acme Corp', hub: 'Central Hub', address: 'Plot 12, Hi-Tech City', lat: 17.5195, lng: 78.1700, contact: 'Ops Desk' },
    { name: 'Beta Retail', hub: 'Central Hub', address: 'Road 4, Madhapur', lat: 17.5160, lng: 78.1660, contact: 'Site Manager' },
    { name: 'Gamma Logistics', hub: 'South Hub', address: 'Phase 2, Industrial Area', lat: 17.3860, lng: 78.4880, contact: 'Warehouse Lead' }
  ];
  clientSeeds.forEach(function (client) {
    var hub = findHub_(client.hub);
    var exists = findClient_(client.name);
    if (!exists && hub) {
      masterCreate_(ctx, {
        kind: 'client', name: client.name, hubId: hub.hubId, address: client.address,
        lat: client.lat, lng: client.lng, contactName: client.contact
      });
      created.clients++;
    }
  });

  var userSeeds = [
    { userId: 'sup-1001', username: 'supervisor.north', role: 'Supervisor', region: 'North', hub: 'Central Hub', phone: '+910000001001' },
    { userId: 'sup-1002', username: 'supervisor.south', role: 'Supervisor', region: 'South', hub: 'South Hub', phone: '+910000001002' },
    { userId: 'tech-2001', username: 'tech.north1', role: 'Technician', region: 'North', hub: 'Central Hub', reportsTo: 'sup-1001', phone: '+910000002001' },
    { userId: 'tech-2002', username: 'tech.north2', role: 'Technician', region: 'North', hub: 'Central Hub', reportsTo: 'sup-1001', phone: '+910000002002' },
    { userId: 'tech-2003', username: 'tech.south1', role: 'Technician', region: 'South', hub: 'South Hub', reportsTo: 'sup-1002', phone: '+910000002003' }
  ];
  userSeeds.forEach(function (user) {
    var read = readSheet_(masterSheet_());
    if (findUserRow_(read, 'UserId', user.userId) >= 0) return;
    try {
      adminCreateUser_(ctx, {
        userId: user.userId,
        username: user.username,
        phoneNumber: user.phone,
        role: user.role,
        assignedHub: user.hub,
        region: user.region,
        reportsTo: user.reportsTo || '',
        password: 'ChangeMe123!'
      });
      created.users++;
    } catch (e) {
      // seat limit or duplicate: skip quietly during seeding
    }
  });

  var vehicles = ['KA01AB1234', 'KA02CD5678', 'KA03EF9012'];
  var vehicleRead = readSheet_(fySheet_('Vehicles', ctx.fy));
  vehicles.forEach(function (plate) {
    if (findVehicleRow_(vehicleRead, plate) < 0) {
      appendObject_(vehicleRead, {
        PlateNo: plate, PlateRaw: plate, AssignedUserId: 'tech-2001', Hub: 'Central Hub',
        Status: 'Active', AnomalyFlags: '', Source: 'MANUAL', OcrConfidence: 0,
        CreatedAt: now, CreatedBy: 'DEMO', UpdatedAt: now, UpdatedBy: 'DEMO', Active: 'true'
      });
      created.vehicles++;
    }
  });

  var taskRead = readSheet_(fySheet_('Tasks', ctx.fy));
  var statuses = ['InProgress', 'Completed', 'Delayed', 'Interrupted'];
  for (var i = 0; i < 6; i++) {
    var jobId = 'DEMO-J-' + (1001 + i);
    if (findTaskRow_(taskRead, jobId) >= 0) continue;
    appendObject_(taskRead, {
      JobId: jobId,
      AssignedUserId: i % 2 === 0 ? 'tech-2001' : 'tech-2003',
      Hub: i % 2 === 0 ? 'Central Hub' : 'South Hub',
      Client: i % 2 === 0 ? 'Acme Corp' : 'Gamma Logistics',
      ClientId: i % 2 === 0 ? 'CLI-0001' : 'CLI-0003',
      Status: statuses[i % statuses.length],
      StartTime: new Date(Date.now() - (i + 1) * 3600 * 1000),
      EndTime: i % 2 === 1 ? new Date(Date.now() - i * 1800 * 1000) : '',
      TurnaroundMinutes: i % 2 === 1 ? 45 : 0,
      ServiceNotes: 'Sample job card',
      VehicleNo: vehicles[i % vehicles.length],
      Checklist: 'Inspect; diagnose; close',
      PartsUsed: '',
      JobCardPhotoUrl: '',
      PlateSource: 'MANUAL',
      OcrConfidence: 0,
      SessionId: '',
      CreatedAt: now, CreatedBy: 'DEMO', UpdatedAt: now, UpdatedBy: 'DEMO'
    });
    created.jobs++;
  }

  writeAudit_(ctx, 'SampleDataSeeded', JSON.stringify(created), false);
  return { created: created };
}

function clearSampleData_(ctx) {
  requireCapability_(ctx);
  var ss = getPrimaryStore();
  var removed = 0;
  FY_TABLES.forEach(function (base) {
    var name = base + '_' + ctx.fy;
    var sheet = ss.getSheetByName(name);
    if (!sheet) return;
    var read = readSheet_(sheet);
    if (read.map['CreatedBy'] === undefined) return;
    for (var i = read.rows.length - 1; i >= 0; i--) {
      if (String(sheetPlain_(cell_(read, read.rows[i], 'CreatedBy'))) !== 'DEMO') continue;
      sheet.deleteRow(i + 2);
      removed++;
    }
  });
  writeAudit_(ctx, 'SampleDataCleared', String(removed), false);
  return { removed: removed };
}

/**
 * Writes the operator folder IDs, replacing the earlier placeholder value so an
 * already-initialised workspace moves to the correct attendance folder.
 */
function applyProofFolders_(props) {
  var job = props.getProperty('DRIVE_FOLDER_JOB') || '';
  var attendance = props.getProperty('DRIVE_FOLDER_ATTENDANCE') || '';

  if (!job || job === LEGACY_ATTENDANCE_FOLDER_ID) {
    props.setProperty('DRIVE_FOLDER_JOB', DEFAULT_JOB_FOLDER_ID);
    setSetting_('JobPhotoFolderId', DEFAULT_JOB_FOLDER_ID);
  }
  if (!attendance || attendance === LEGACY_ATTENDANCE_FOLDER_ID) {
    props.setProperty('DRIVE_FOLDER_ATTENDANCE', DEFAULT_ATTENDANCE_FOLDER_ID);
    setSetting_('AttendancePhotoFolderId', DEFAULT_ATTENDANCE_FOLDER_ID);
  }
}

