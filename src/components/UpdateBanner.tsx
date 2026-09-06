import React, { useCallback } from 'react';
import { View, TouchableOpacity, Linking } from 'react-native';
import { MotiView } from 'moti';
import { LucideArrowUpCircle } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { ThemedText } from './ThemedSafeAreaView';
import { useTheme } from '../theme/ThemeProvider';
import { useStore } from '../store/useStore';
import { fonts } from '../theme/tokens';

/**
 * "A newer build is out" banner, fed by services/updateChecker.
 *
 * Publishing to Play makes an update *available* but shows nothing inside the
 * app; users with auto-update off can sit on an old build indefinitely. This is
 * the in-app signal. It can only deep-link to the store listing — a serverless
 * app can't install anything itself.
 *
 * Renders nothing at all when there is no update, so it is safe to mount
 * unconditionally.
 */
export const UpdateBanner: React.FC = () => {
  const { colors } = useTheme();
  const updateInfo = useStore((s) => s.updateInfo);
  const dismissedVersionCode = useStore((s) => s.updateDismissedVersionCode);
  const dismissUpdate = useStore((s) => s.dismissUpdate);
  const hapticsEnabled = useStore((s) => s.preferences.hapticsEnabled);

  const haptic = useCallback(() => {
    if (hapticsEnabled) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [hapticsEnabled]);

  const handleUpdate = useCallback(() => {
    if (!updateInfo) return;
    haptic();
    Linking.openURL(updateInfo.url).catch(() => {
      // Store app missing or URL unopenable — nothing useful to say, and the
      // banner stays put so the user can try again.
    });
  }, [updateInfo, haptic]);

  const handleDismiss = useCallback(() => {
    if (!updateInfo) return;
    haptic();
    dismissUpdate(updateInfo.versionCode);
  }, [updateInfo, haptic, dismissUpdate]);

  if (!updateInfo) return null;
  // A mandatory update ignores a previous dismissal — that is the whole point
  // of minSupportedVersionCode.
  if (!updateInfo.mandatory && dismissedVersionCode === updateInfo.versionCode) return null;

  const tint = updateInfo.mandatory ? colors.warning : colors.accent;
  const tintSoft = updateInfo.mandatory ? colors.debitSoft : colors.brandSoft;

  return (
    <MotiView
      from={{ opacity: 0, translateY: -8 }}
      animate={{ opacity: 1, translateY: 0 }}
      style={{
        padding: 20,
        borderRadius: 14,
        marginBottom: 24,
        borderWidth: 1,
        flexDirection: 'row',
        gap: 16,
        backgroundColor: tintSoft,
        borderColor: `${tint}30`,
      }}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          backgroundColor: `${tint}25`,
        }}
      >
        <LucideArrowUpCircle color={tint} size={20} />
      </View>

      <View style={{ flex: 1 }}>
        <ThemedText style={{ fontFamily: fonts.textSemibold, fontSize: 14 }}>
          {updateInfo.mandatory ? 'Update required' : 'Update available'}
          {updateInfo.versionName ? ` · ${updateInfo.versionName}` : ''}
        </ThemedText>

        <ThemedText type="secondary" style={{ fontSize: 12, marginTop: 4, lineHeight: 18 }}>
          {updateInfo.mandatory
            ? 'This version of Echo Spend is no longer supported. Please update to keep your data safe.'
            : 'A newer version of Echo Spend is available on the Play Store.'}
        </ThemedText>

        {updateInfo.releaseNotes.length > 0 && (
          <View style={{ marginTop: 10, gap: 4 }}>
            {updateInfo.releaseNotes.map((note, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
                <ThemedText type="muted" style={{ fontSize: 12, lineHeight: 18 }}>
                  •
                </ThemedText>
                <ThemedText
                  type="secondary"
                  style={{ fontSize: 12, lineHeight: 18, flex: 1 }}
                >
                  {note}
                </ThemedText>
              </View>
            ))}
          </View>
        )}

        <View style={{ flexDirection: 'row', gap: 16, marginTop: 16 }}>
          <TouchableOpacity
            onPress={handleUpdate}
            style={{
              paddingHorizontal: 16,
              paddingVertical: 8,
              borderRadius: 8,
              backgroundColor: colors.accent,
            }}
          >
            <ThemedText
              style={{
                color: colors.onAccent,
                fontFamily: fonts.textSemibold,
                fontSize: 12,
              }}
            >
              Update
            </ThemedText>
          </TouchableOpacity>

          {!updateInfo.mandatory && (
            <TouchableOpacity
              onPress={handleDismiss}
              style={{
                paddingHorizontal: 16,
                paddingVertical: 8,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              <ThemedText
                type="secondary"
                style={{ fontFamily: fonts.textSemibold, fontSize: 12 }}
              >
                Later
              </ThemedText>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </MotiView>
  );
};
