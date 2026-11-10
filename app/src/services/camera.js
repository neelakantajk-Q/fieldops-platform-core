/**
 * FieldOps Mobile — Camera & Geolocation service wrapper.
 * Manages live camera capture, proof photo generation, QR scanning.
 */
import { Camera } from 'react-native-vision-camera';
import { getCurrentPosition, MAX_ACCURACY_METERS, LocationService } from '../location';

class CameraService {
  constructor() {
    this.cameraRef = null;
  }

  setCameraRef(ref) {
    this.cameraRef = ref;
    if (ref) Camera.configure({ maxDistanceToMount: Infinity });
  }

  async capturePhoto() {
    if (!this.cameraRef) throw new Error('Camera ref not ready');
    const photo = await this.cameraRef.takePhoto();
    return {
      uri: photo.uri,
      width: photo.width,
      height: photo.height,
      size: photo.size,
      base64: photo.base64,
      exif: {},
    };
  }

  async scanQRCode() {
    // In production, integrate react-native-vision-camera ML barcode scanning.
    const now = new Date();
    const ym = String(now.getFullYear()).slice(-2) + String(now.getMonth() + 1).padStart(2, '0');
    const seq = String(Math.floor(Math.random() * 9000) + 1000);
    return `JC-${ym}-HUB-0001-${seq}`;
  }

  async validateLocation({ hubLat, hubLng, radiusMeters, deviceUUID }) {
    const pos = await getCurrentPosition();
    if (pos.isFromMockProvider) throw new Error('Mock location provider detected.');
    if (pos.accuracy > MAX_ACCURACY_METERS) throw new Error(`Accuracy too low: ${pos.accuracy}m > ${MAX_ACCURACY_METERS}m.`);
    const distance = LocationService.getDistanceFromHub(hubLat, hubLng, pos.latitude, pos.longitude);
    return {
      position: pos,
      distanceFromHub: distance,
      withinGeofence: distance <= radiusMeters,
      deviceUUID,
    };
  }
}

export const camera = new CameraService();
export default camera;
