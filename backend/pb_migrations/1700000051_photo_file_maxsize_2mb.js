/// <reference path="../pb_data/types.d.ts" />
/**
 * 1700000051_photo_file_maxsize_2mb.js
 *
 * Cap all photo file fields at 2 MB so camera proofs cannot inflate the
 * PocketBase instance past its free-tier quota. Cold-storage (Drive) holds
 * the originals; this keeps PocketBase storage tiny.
 */
migrate((db) => {
  const dao = new Dao(db);
  const targets = [
    { col: "attendance", fields: ["photo_proof", "checkout_photo"] },
    { col: "captures", fields: ["photo"] },
    { col: "job_cards", fields: ["start_proof_photo", "end_proof_photo"] },
    { col: "dealer_visits", fields: ["check_in_photo", "check_out_photo"] },
    { col: "asset_custody_events", fields: ["photo"] },
  ];
  const MAX_SIZE = 2097152; // 2 MB
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    try {
      const col = dao.findCollectionByNameOrId(t.col);
      for (let j = 0; j < t.fields.length; j++) {
        const f = col.schema.getFieldByName(t.fields[j]);
        if (f) f.options.maxSize = MAX_SIZE;
      }
      dao.saveCollection(col);
    } catch (e) { /* best effort */ }
  }
}, (db) => {
  const dao = new Dao(db);
  const targets = [
    { col: "attendance", fields: ["photo_proof", "checkout_photo"] },
    { col: "captures", fields: ["photo"] },
    { col: "job_cards", fields: ["start_proof_photo", "end_proof_photo"] },
    { col: "dealer_visits", fields: ["check_in_photo", "check_out_photo"] },
    { col: "asset_custody_events", fields: ["photo"] },
  ];
  const MAX_SIZE = 10485760; // 10 MB
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    try {
      const col = dao.findCollectionByNameOrId(t.col);
      for (let j = 0; j < t.fields.length; j++) {
        const f = col.schema.getFieldByName(t.fields[j]);
        if (f) f.options.maxSize = MAX_SIZE;
      }
      dao.saveCollection(col);
    } catch (e) { /* best effort */ }
  }
});
