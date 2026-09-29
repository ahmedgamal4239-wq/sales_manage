import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'sales-operations-mobile-token';
let memoryToken: string | null = null;
let unauthorizedHandler: (() => void | Promise<void>) | null = null;

export function setUnauthorizedHandler(handler: (() => void | Promise<void>) | null) {
  unauthorizedHandler = handler;
}

export function handleUnauthorizedError(error: unknown) {
  if (
    error &&
    typeof error === 'object' &&
    'status' in error &&
    (error as { status?: unknown }).status === 401
  ) {
    void unauthorizedHandler?.();
  }
}

export async function readToken(): Promise<string | null> {
  if (Platform.OS === 'web') {
    try {
      return typeof sessionStorage !== 'undefined'
        ? sessionStorage.getItem(TOKEN_KEY)
        : memoryToken;
    } catch {
      return memoryToken;
    }
  }
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function writeToken(token: string | null): Promise<void> {
  memoryToken = token;
  if (Platform.OS === 'web') {
    try {
      if (typeof sessionStorage !== 'undefined') {
        if (token) sessionStorage.setItem(TOKEN_KEY, token);
        else sessionStorage.removeItem(TOKEN_KEY);
      }
    } catch {
      // Keep the session in memory when browser storage is unavailable.
    }
    return;
  }
  if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}