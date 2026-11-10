/**
 * FieldOps Mobile — Telemetry canvas watermarking service.
 * Burns Job Card Code, VIN, Tech Name, Server Timestamp, Lat/Lng, Hub In-Fence Status into JPEG pixels.
 */
export class WatermarkService {
  static async burnWatermark(photo, telemetry = {}) {
    const {
      jobCardCode = '',
      vin = '',
      techName = '',
      serverTimestamp = '',
      latitude = '',
      longitude = '',
      hubInFenceStatus = '',
    } = telemetry;

    // In production, render onto a canvas (react-native-skia / native canvas) and export JPEG.
    // Here we simulate the base64 JPEG output with the telemetry payload embedded.
    const payload = {
      jobCardCode, vin, techName, serverTimestamp, latitude, longitude, hubInFenceStatus,
      image: { width: photo.width || 1920, height: photo.height || 1080, quality: photo.quality || 0.85 },
    };
    const json = JSON.stringify(payload);
    const base64 = typeof btoa === 'function'
      ? btoa(unescape(encodeURIComponent(json)))
      : Buffer.from(json, 'utf8').toString('base64');
    return `data:image/jpeg;base64,${base64}`;
  }

  static generateJobCode({ year = new Date().getFullYear(), month, hubCode = 'HUB-0001', seq }) {
    const ym = String(year).slice(-2) + String(month || new Date().getMonth() + 1).padStart(2, '0');
    const code = `JC-${ym}-${hubCode}-${String(seq || Math.floor(Math.random() * 9000) + 1000)}`;
    return { jobCode: code, fullCode: code };
  }
}

export default new WatermarkService();
