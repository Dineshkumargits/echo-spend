import React from 'react';
import { View, StyleSheet, ActivityIndicator, Dimensions } from 'react-native';
import { MotiView, AnimatePresence } from 'moti';
import { useStore } from '../store/useStore';
import { ThemedText } from './ThemedSafeAreaView';
import { useTheme } from '../theme/ThemeProvider';
import { withAlpha } from '../theme/tokens';
import { LucideCloudSync } from 'lucide-react-native';

const { width, height } = Dimensions.get('window');

export const SyncOverlay = () => {
  const { isSyncing, syncProgressText } = useStore();
  const { colors } = useTheme();

  return (
    <AnimatePresence>
      {isSyncing && (
        <MotiView
          from={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ type: 'timing', duration: 300 }}
          style={[
            styles.container,
            { backgroundColor: withAlpha(colors.background, 'D9') }
          ]}
        >
          <MotiView
            from={{ scale: 0.9, opacity: 0, translateY: 20 }}
            animate={{ scale: 1, opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', damping: 15 }}
            style={styles.content}
          >
            <View style={[styles.iconContainer, { backgroundColor: colors.accent + '15' }]}>
              <MotiView
                from={{ rotate: '0deg' }}
                animate={{ rotate: '360deg' }}
                transition={{ loop: true, type: 'timing', duration: 2000, repeatReverse: false }}
              >
                <LucideCloudSync color={colors.accent} size={48} />
              </MotiView>
            </View>

            <ThemedText className="text-xl font-bold mt-6 mb-2">Syncing Data</ThemedText>
            <ThemedText type="secondary" className="text-center px-6">
              {syncProgressText || 'Please wait while we secure your data...'}
            </ThemedText>

            <View style={styles.loaderContainer}>
              <ActivityIndicator color={colors.accent} size="large" />
            </View>

            <ThemedText className="text-[10px] uppercase font-bold tracking-widest mt-8" style={{ color: colors.secondary }}>
              Do not close the app
            </ThemedText>
          </MotiView>
        </MotiView>
      )}
    </AnimatePresence>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    width: width * 0.8,
    padding: 32,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loaderContainer: {
    marginTop: 32,
  },
});

export default SyncOverlay;
