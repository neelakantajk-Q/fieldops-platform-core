/**
 * FieldOps Mobile — Location service with anti-cheat & geofence enforcement.
 * Blocks actions if Location.isFromMockProvider() is true.
 * Enforces GPS horizontal accuracy threshold (<= 25m).
 */
import { Platform } from 'react-native';

export const MAX_ACCURACY_METERS = 25;

export class LocationService {
  constructor() {
    this.currentPosition = null;
    this.lastError = null;
  }

  async getCurrentPosition() {
    // Mock implementation for cross-platform compatibility.
    // In production, use react-native-geolocation-service or expo-location.
    try {
      const position = await this._requestPosition();
      this.lastError = null;
      return position;
    } catch (err) {
      this.lastError = err;
      throw err;
    }
  }

  async _requestPosition() {
    // Placeholder: replace with actual geolocation API.
    return {
      latitude: 17.5181,
      longitude: 78.1685,
      accuracy: 5.0,
      isFromMockProvider: false,
      timestamp: new Date().toISOString(),
    };
  }

  async isFromMockProvider() {
    try {
      const pos = await this._requestPosition();
      return Boolean(pos.isFromMockProvider);
    } catch (_) {
      return false;
    }
  }

  async getHardwareUUID() {
    // Placeholder: replace with react-native-device-info or similar.
    return `device-${Math.random().toString(36).slice(2, 10)}`;
  }

  async getDistanceFromHub(hubLat, hubLon, posLat, posLon) {
    const R = 6371000;
    const toRad = (d) => d * Math.PI / 180;
    const dLat = toRad(posLat - hubLat);
    const dLon = toRad(posLon - hubLon);
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(hubLat)) * Math.cos(toRad(posLat)) *
      Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  async validateForAction(hubLat, hubLon, radiusMeters) {
    const pos = await this.getCurrentPosition();
    if (pos.isFromMockProvider) {
      throw new Error('Mock location provider detected. Action blocked.');
    }
    if (pos.accuracy > MAX_ACCURACY_METERS) {
      throw new Error(`GPS accuracy ${pos.accuracy}m exceeds ${MAX_ACCURACY_METERS}m threshold.`);
    }
    const distance = await this.getDistanceFromHub(hubLat, hubLon, pos.latitude, pos.longitude);
    const within = distance <= radiusMeters;
    return {
      position: pos,
      distanceFromHub: Math.round(distance),
      withinGeofence: within,
      deviceUUID: await this.getHardwareUUID(),
    };
  }
}

export default new LocationService();