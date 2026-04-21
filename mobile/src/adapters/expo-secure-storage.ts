import * as SecureStore from "expo-secure-store";
import type { SecureStorageAdapter } from "../secure-storage";

export class ExpoSecureStorageAdapter implements SecureStorageAdapter {
  async getItem(key: string): Promise<string | null> {
    return SecureStore.getItemAsync(key);
  }

  async setItem(key: string, value: string): Promise<void> {
    await SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY
    });
  }

  async removeItem(key: string): Promise<void> {
    await SecureStore.deleteItemAsync(key);
  }
}
