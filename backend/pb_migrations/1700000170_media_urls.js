/// <reference path="../pb_data/types.d.ts" />
/**
 * 1700000170_media_urls.js
 *
 * Durable photo references. Render's free disk is ephemeral, so PocketBase
 * file blobs (photo_proof / checkout_photo / start_proof_photo / photo) can
 * disappear on a cold start. The originals are uploaded to Google Drive by
 * POST /api/fieldops/media-upload and the returned URL is stored here.
 *
 *   attendance.photo_url / photo_file_id / photo_provider
 *   attendance.checkin_photo_url / checkout_photo_url
 *   attendance.source                         APP | ROAMING | WEB | AUTO
 *   roaming_requests.photo_url / photo_file_id / purpose / decision_notes
 *   job_cards.start_photo_url / end_photo_url
 *   captures.photo_url
 */
migrate((db) => {
  const dao = new Dao(db);

  const addFields = (collection, fields) => {
    const c = dao.findCollectionByNameOrId(collection);
    const text = (name) => ({
      name, type: "text", required: false, unique: false,
      options: { min: null, max: null, pattern: "" }
    });
    for (let i = 0; i < fields.length; i++) {
      const field = text(fields[i]);
      try {
        if (!c.schema.getFieldByName(field.name)) c.schema.addField(new SchemaField(field));
      } catch (err) {
        try { c.schema.addField(new SchemaField(field)); } catch (e) { /* already there */ }
      }
    }
    dao.saveCollection(c);
  };

  addFields("attendance", [
    "photo_url", "photo_file_id", "photo_provider",
    "checkin_photo_url", "checkout_photo_url", "source"
  ]);
  addFields("roaming_requests", [
    "photo_url", "photo_file_id", "purpose", "decision_notes"
  ]);
  addFields("job_cards", ["start_photo_url", "end_photo_url"]);
  addFields("captures", ["photo_url"]);
}, (db) => {
  const dao = new Dao(db);
  const removeFields = (collection, names) => {
    const c = dao.findCollectionByNameOrId(collection);
    for (let i = 0; i < names.length; i++) {
      try {
        const f = c.schema.getFieldByName(names[i]);
        if (f) c.schema.removeField(f.id);
      } catch (err) { /* already gone */ }
    }
    dao.saveCollection(c);
  };
  removeFields("attendance", [
    "photo_url", "photo_file_id", "photo_provider",
    "checkin_photo_url", "checkout_photo_url", "source"
  ]);
  removeFields("roaming_requests", [
    "photo_url", "photo_file_id", "purpose", "decision_notes"
  ]);
  removeFields("job_cards", ["start_photo_url", "end_photo_url"]);
  removeFields("captures", ["photo_url"]);
});
