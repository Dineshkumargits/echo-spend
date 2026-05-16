import { useCallback } from 'react';
import { SmsParserService, ParsedSmsResult, hashSms, ScanContext } from '../services/smsParserService';

export { hashSms };
export type { ParsedSmsResult, ScanContext };

/**
 * Hook-based wrapper around the SMS Parser Service for UI components.
 */
export const useAISmsParser = () => {
  const parseSms = useCallback(async (
    smsBody: string,
    merchantHints: Array<{ raw: string; clean: string; category: string }> = [],
    context?: Partial<ScanContext>,
    smsTimestamp?: number,
  ): Promise<ParsedSmsResult> => {
    return SmsParserService.parse(
      smsBody,
      context?.categories?.map(c => c.name) ?? [],
      merchantHints,
      context,
      smsTimestamp,
    );
  }, []);

  return { parseSms };
};
