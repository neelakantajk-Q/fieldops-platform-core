// Free-tier quota guard: request logs live in logs.db and can grow past the
// 50 MB instance cap. Purge them on boot, then keep only 3 days via cron.
onAfterBootstrap((e) => {
  try {
    $app.logsDao().deleteOldLogs(new Date());
  } catch (err) {
    console.log("quota_cleanup: boot log purge failed:", String(err));
  }
});

cronAdd("quota_logs", "15 3 * * *", () => {
  try {
    $app.logsDao().deleteOldLogs(new Date(Date.now() - 3 * 24 * 60 * 60 * 1000));
  } catch (err) {
    console.log("quota_cleanup: cron log purge failed:", String(err));
  }
});
