import * as ImagePicker from 'expo-image-picker';

export type ScanCameraPermission = 'granted' | 'denied';

export async function requestScanCameraPermission(): Promise<ScanCameraPermission> {
  const result = await ImagePicker.requestCameraPermissionsAsync();
  return result.granted ? 'granted' : 'denied';
}
