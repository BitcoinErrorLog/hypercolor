import { Camera } from 'expo-camera';

export type ScanCameraPermission = 'granted' | 'denied';

export async function requestScanCameraPermission(): Promise<ScanCameraPermission> {
  const result = await Camera.requestCameraPermissionsAsync();
  return result.granted ? 'granted' : 'denied';
}
