import React, { useState, useEffect, useRef } from 'react';
import {
  View, TouchableOpacity, Animated, Easing, StyleSheet, Platform,
} from 'react-native';
import { ThemedText } from '../components/ThemedSafeAreaView';
import { MotiView } from 'moti';
import * as Haptics from 'expo-haptics';
import {
  LucideBrain, LucideDownload, LucideCheck, LucideRefreshCcw,
  LucideWifi, LucideAlertTriangle, LucideX,
} from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../theme/ThemeProvider';
import { AIModelManager } from '../services/aiModelManager';
import { useStore } from '../store/useStore';

interface AIModelSetupStepProps {
  onComplete?: () => void;
  showClose?: boolean;
}

/**
 * AI Model download step — used in both onboarding and as a standalone screen.
 * Shows download progress and handles the full lifecycle.
 */
const AIModelSetupStep = ({ onComplete, showClose = false }: AIModelSetupStepProps) => {
  const { colors } = useTheme();
  const navigation = useNavigation<any>();
  const { aiModelStatus, aiModelProgress, aiModelError } = useStore();
  const [error, setError] = useState<string | null>(null);

  // Sparkle animation
  const sparkleAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(sparkleAnim, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(sparkleAnim, { toValue: 0, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    ).start();
  }, []);

  const sparkleScale = sparkleAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.15] });
  const sparkleOpacity = sparkleAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.7, 1, 0.7] });

  // Close or complete setup helper
  const handleComplete = () => {
    if (onComplete) {
      onComplete();
    } else if (navigation.canGoBack()) {
      navigation.goBack();
    }
  };

  // Sync error with store
  useEffect(() => {
    if (aiModelStatus === 'error') {
      setError(aiModelError || 'Download failed. Please check your connection.');
    } else {
      setError(null);
    }
  }, [aiModelStatus, aiModelError]);

  // Auto-proceed after download completes
  useEffect(() => {
    if (aiModelStatus === 'downloaded' || aiModelStatus === 'ready') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const timer = setTimeout(handleComplete, 1200);
      return () => clearTimeout(timer);
    }
  }, [aiModelStatus]);

  // Cleanup download on unmount if it's still downloading
  useEffect(() => {
    return () => {
      const store = useStore.getState();
      if (store.aiModelStatus === 'downloading') {
        console.log('[AIModelSetupStep] Component unmounted during download. Cancelling...');
        AIModelManager.cancelDownload();
      }
    };
  }, []);

  const handleDownload = async () => {
    setError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await AIModelManager.downloadModel();
    } catch (err: any) {
      setError(err?.message || 'Download failed. Please check your connection.');
    }
  };

  const handleCancel = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await AIModelManager.cancelDownload();
    handleComplete();
  };

  const handleSkip = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    handleComplete();
  };

  const isCompatible = AIModelManager.isDeviceCompatible();
  const isDownloading = aiModelStatus === 'downloading';
  const isComplete = aiModelStatus === 'downloaded' || aiModelStatus === 'ready';

  return (
    <View style={{ flex: 1 }}>
      {(showClose || navigation.canGoBack()) && !isDownloading && (
        <TouchableOpacity
          onPress={handleSkip}
          style={[styles.closeButton, { top: Platform.OS === 'ios' ? 50 : 16, right: 16 }]}
          activeOpacity={0.7}
        >
          <LucideX color={colors.primary} size={24} />
        </TouchableOpacity>
      )}
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
        <MotiView
          from={{ opacity: 0, translateY: 30 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 500 }}
          style={{ alignItems: 'center', width: '100%' }}
        >
          {/* Animated Icon */}
          <Animated.View style={[
            styles.iconContainer,
            {
              backgroundColor: isComplete ? colors.success : `${colors.accent}20`,
              transform: [{ scale: sparkleScale }],
              opacity: sparkleOpacity,
            },
          ]}>
            {isComplete ? (
              <LucideCheck color="#fff" size={44} />
            ) : (
              <LucideBrain color={colors.accent} size={44} />
            )}
          </Animated.View>

          {/* Title */}
          <ThemedText style={[styles.title, { color: colors.primary }]}>
            {isComplete ? 'Echo AI is Ready!' : 'Power Up Echo AI'}
          </ThemedText>

          {/* Subtitle */}
          <ThemedText style={[styles.subtitle, { color: colors.secondary }]}>
            {isComplete
              ? 'Your offline Echo AI is set up. Smart SMS parsing is now active.'
              : !isCompatible
                ? 'Echo AI is disabled because your device has less than 2GB of total RAM. Echo Spend will use high-performance local regex parsing to scan transactions safely.'
                : 'A small local AI will be downloaded to your device for intelligent SMS analysis. Everything runs locally — your data never leaves your phone.'}
          </ThemedText>

          {/* Size Badge */}
          {!isDownloading && !isComplete && isCompatible && (
            <MotiView
              from={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'timing', duration: 300, delay: 200 }}
              style={[styles.sizeBadge, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <LucideDownload color={colors.accent} size={14} />
              <ThemedText style={[styles.sizeText, { color: colors.primary }]}>~980 MB</ThemedText>
              <View style={[styles.dot, { backgroundColor: colors.muted }]} />
              <ThemedText style={[styles.sizeText, { color: colors.secondary }]}>One-time download</ThemedText>
            </MotiView>
          )}

          {/* WiFi Recommendation */}
          {!isDownloading && !isComplete && isCompatible && (
            <MotiView
              from={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ type: 'timing', duration: 300, delay: 400 }}
              style={styles.wifiNote}
            >
              <LucideWifi color={colors.muted} size={12} />
              <ThemedText style={[styles.wifiText, { color: colors.muted }]}>
                WiFi recommended for faster download
              </ThemedText>
            </MotiView>
          )}

          {/* Progress Bar */}
          {isDownloading && (
            <MotiView
              from={{ opacity: 0, translateY: 10 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'timing', duration: 300 }}
              style={{ width: '100%', marginTop: 32 }}
            >
              <View style={[styles.progressTrack, { backgroundColor: colors.translucent }]}>
                <MotiView
                  animate={{ width: `${aiModelProgress}%` }}
                  transition={{ type: 'timing', duration: 300 }}
                  style={[
                    styles.progressBar,
                    {
                      backgroundColor: colors.accent,
                    },
                  ]}
                />
              </View>
              <View style={styles.progressInfo}>
                <ThemedText style={[styles.progressText, { color: colors.secondary }]}>
                  Downloading Echo AI...
                </ThemedText>
                <ThemedText style={[styles.progressPercent, { color: colors.accent }]}>
                  {aiModelProgress}%
                </ThemedText>
              </View>
              <ThemedText style={[styles.dontClose, { color: colors.muted }]}>
                Please don't close the app
              </ThemedText>
            </MotiView>
          )}

          {/* Error State */}
          {error && !isDownloading && (
            <MotiView
              from={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              style={[styles.errorCard, { backgroundColor: `${colors.danger}15`, borderColor: `${colors.danger}30` }]}
            >
              <LucideAlertTriangle color={colors.danger} size={16} />
              <ThemedText style={[styles.errorText, { color: colors.danger }]}>
                {error}
              </ThemedText>
            </MotiView>
          )}
        </MotiView>
      </View>

      {/* CTAs */}
      <MotiView
        from={{ opacity: 0, translateY: 12 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ delay: 300, type: 'spring', damping: 18 }}
        style={{ paddingHorizontal: 24, paddingBottom: 24, gap: 12 }}
      >
        {isDownloading && (
          <TouchableOpacity
            onPress={handleCancel}
            style={[styles.secondaryButton, { borderColor: colors.border }]}
            activeOpacity={0.7}
          >
            <LucideX color={colors.secondary} size={20} />
            <ThemedText style={[styles.secondaryButtonText, { color: colors.secondary }]}>
              Cancel Download
            </ThemedText>
          </TouchableOpacity>
        )}

        {!isDownloading && !isComplete && (
          isCompatible ? (
            error ? (
              // Error options: retry or cancel completely
              <View style={{ gap: 12 }}>
                <TouchableOpacity
                  onPress={handleDownload}
                  style={[styles.primaryButton, { backgroundColor: colors.accent }]}
                  activeOpacity={0.8}
                >
                  <LucideRefreshCcw color="#fff" size={20} />
                  <ThemedText style={styles.primaryButtonText}>
                    Retry Download
                  </ThemedText>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={handleCancel}
                  style={[styles.secondaryButton, { borderColor: colors.border }]}
                  activeOpacity={0.7}
                >
                  <LucideX color={colors.secondary} size={20} />
                  <ThemedText style={[styles.secondaryButtonText, { color: colors.secondary }]}>
                    Cancel
                  </ThemedText>
                </TouchableOpacity>
              </View>
            ) : (
              // Normal state: start download or skip
              <>
                <TouchableOpacity
                  onPress={handleDownload}
                  style={[styles.primaryButton, { backgroundColor: colors.accent }]}
                  activeOpacity={0.8}
                >
                  <LucideDownload color="#fff" size={20} />
                  <ThemedText style={styles.primaryButtonText}>
                    Download Echo AI
                  </ThemedText>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={handleSkip}
                  style={styles.skipButton}
                  activeOpacity={0.7}
                >
                  <ThemedText style={[styles.skipText, { color: colors.secondary }]}>
                    Skip for now
                  </ThemedText>
                </TouchableOpacity>
                <ThemedText style={[styles.skipNote, { color: colors.muted }]}>
                  You can download later in Settings. SMS parsing will use basic mode.
                </ThemedText>
              </>
            )
          ) : (
            <>
              <TouchableOpacity
                onPress={handleSkip}
                style={[styles.primaryButton, { backgroundColor: colors.accent }]}
                activeOpacity={0.8}
              >
                <ThemedText style={styles.primaryButtonText}>
                  Continue in Basic Mode
                </ThemedText>
              </TouchableOpacity>
              <ThemedText style={[styles.skipNote, { color: colors.muted, marginTop: 4 }]}>
                Device RAM is too low to run local AI safely. Basic mode will match bank messages deterministically.
              </ThemedText>
            </>
          )
        )}
      </MotiView>
    </View>
  );
};

const styles = StyleSheet.create({
  iconContainer: {
    width: 100,
    height: 100,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 8,
    marginBottom: 20,
  },
  sizeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  sizeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  dot: {
    width: 3,
    height: 3,
    borderRadius: 2,
  },
  wifiNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
  },
  wifiText: {
    fontSize: 11,
  },
  progressTrack: {
    width: '100%',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    borderRadius: 4,
  },
  progressInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  progressText: {
    fontSize: 12,
  },
  progressPercent: {
    fontSize: 13,
    fontWeight: '700',
  },
  dontClose: {
    fontSize: 11,
    textAlign: 'center',
    marginTop: 8,
  },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 16,
  },
  errorText: {
    fontSize: 12,
    flex: 1,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 16,
    borderRadius: 99,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 16,
    borderRadius: 99,
    borderWidth: 1,
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
  },
  skipButton: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  skipText: {
    fontSize: 14,
    fontWeight: '500',
  },
  skipNote: {
    fontSize: 10,
    textAlign: 'center',
    lineHeight: 14,
  },
  closeButton: {
    position: 'absolute',
    padding: 12,
    zIndex: 10,
  },
});

export default AIModelSetupStep;
