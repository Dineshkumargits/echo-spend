import { useCallback, useState } from 'react';
import * as LocalAuthentication from 'expo-local-authentication';

export const useBiometric = () => {
  const [isSupported, setIsSupported] = useState<boolean | null>(null);

  const checkSupport = useCallback(async (): Promise<boolean> => {
    const compatible = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    const supported = compatible && enrolled;
    setIsSupported(supported);
    return supported;
  }, []);

  const authenticate = useCallback(async (reason = 'Authenticate to access Echo Spend'): Promise<boolean> => {
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: reason,
        fallbackLabel: 'Use Passcode',
        cancelLabel: 'Cancel',
        disableDeviceFallback: false,
      });
      return result.success;
    } catch {
      return false;
    }
  }, []);

  const getAvailableTypes = useCallback(async () => {
    return await LocalAuthentication.supportedAuthenticationTypesAsync();
  }, []);

  return { isSupported, checkSupport, authenticate, getAvailableTypes };
};
