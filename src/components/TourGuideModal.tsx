import React, { useState } from 'react';
import {
  View,
  Modal,
  TouchableOpacity,
  ScrollView,
  Dimensions,
  StyleSheet,
  Platform,
} from 'react-native';
import { MotiView, AnimatePresence } from 'moti';
import {
  LucideBrain,
  LucideZap,
  LucideCloud,
  LucideTarget,
  LucideSearch,
  LucideRepeat,
  LucideChevronRight,
  LucideChevronLeft,
  LucideX,
  LucideSparkles,
  LucideCheckCircle2,
} from 'lucide-react-native';
import { ThemedText } from './ThemedSafeAreaView';
import { useTheme } from '../theme/ThemeProvider';
import * as Haptics from 'expo-haptics';

interface TourGuideModalProps {
  visible: boolean;
  onClose: () => void;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const SLIDES = [
  {
    title: 'Private Smart Scanner',
    icon: LucideBrain,
    color: '#56D4C0',
    tagline: '100% Private & Secure',
    description: 'Echo Spend has a smart assistant that reads and understands your bank SMS directly on your phone. Your money details never leave your device and are never sent to any cloud server.',
    bullets: [
      'Super fast automatic category sorting',
      'No account sign-up needed to scan data',
      'Keeps your account details completely safe'
    ]
  },
  {
    title: 'Automatic SMS Import',
    icon: LucideZap,
    color: '#FFD60A',
    tagline: 'Record Expenses Instantly',
    description: 'When you get a message from your bank, Echo Spend reads it immediately, finds the merchant and amount, and sends you a notification to review and approve it.',
    bullets: [
      'Reads SMS as soon as they arrive',
      'Matches transactions to the correct account automatically',
      'Saves you from typing transactions manually'
    ]
  },
  {
    title: 'Safe Google Drive Backups',
    icon: LucideCloud,
    color: '#56D4C0',
    tagline: 'Private & Secure Backups',
    description: 'Back up your transactions and settings to your own Google Drive. Echo Spend uses a hidden folder that other apps cannot open, keeping your backups completely private.',
    bullets: [
      'Choose automatic backups (daily or weekly)',
      'Accurate daily timers that work even when your phone is locked',
      'Restore all your data in one click on any device'
    ]
  },
  {
    title: 'Budgets & Financial Cycle',
    icon: LucideTarget,
    color: '#FFB454',
    tagline: 'Set Spending Limits',
    description: 'Echo Spend adapts to your actual payday! Set your custom salary day to reset your monthly calculations. Add spending limits for different categories and get notified at 80%, 90%, and 100% of your limits.',
    bullets: [
      'Choose when your financial month begins (Day 1-31)',
      'Friendly warning alerts so you do not overspend',
      'See exactly where most of your money goes'
    ]
  },
  {
    title: 'Easy Search & Filters',
    icon: LucideSearch,
    color: '#BF5AF2',
    tagline: 'Find Any Spend Instantly',
    description: 'Easily look through your transaction history. Search for shop names or notes, and filter your lists by specific accounts, tags, date ranges, and categories.',
    bullets: [
      'Clean slide-up panel with quick filter settings',
      'Fast category search bar when reviewing transactions',
      'Organize your spends with simple tags (like #vacation)'
    ]
  },
  {
    title: 'Bills & Shared Expenses',
    icon: LucideRepeat,
    color: '#FF2D55',
    tagline: 'Track Subscriptions & Splits',
    description: 'Keep track of repeating bills like Netflix, Spotify, or your home rent. You can also split expenses with your friends and track who owes you money.',
    bullets: [
      'See all your active subscriptions in one place',
      'Split bills with friends and record payments easily',
      'Get countdown reminders for upcoming dues'
    ]
  }
];

export const TourGuideModal: React.FC<TourGuideModalProps> = ({ visible, onClose }) => {
  const { colors, isDark } = useTheme();
  const [activeIdx, setActiveIdx] = useState(0);

  const handleNext = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (activeIdx < SLIDES.length - 1) {
      setActiveIdx(prev => prev + 1);
    } else {
      onClose();
      setActiveIdx(0);
    }
  };

  const handlePrev = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (activeIdx > 0) {
      setActiveIdx(prev => prev - 1);
    }
  };

  const currentSlide = SLIDES[activeIdx];
  const Icon = currentSlide.icon;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={StyleSheet.absoluteFill}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        </View>

        <MotiView
          from={{ opacity: 0, scale: 0.95, translateY: 30 }}
          animate={{ opacity: 1, scale: 1, translateY: 0 }}
          transition={{ type: 'spring', damping: 20 }}
          style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleContainer}>
              <LucideSparkles color={colors.accent} size={18} />
              <ThemedText style={styles.headerTitle}>Echo Spend Guide</ThemedText>
            </View>
            <TouchableOpacity
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onClose();
              }}
              style={styles.closeButton}
            >
              <LucideX color={colors.secondary} size={18} />
            </TouchableOpacity>
          </View>

          {/* Progress Indicators */}
          <View style={styles.progressContainer}>
            {SLIDES.map((_, i) => (
              <View
                key={i}
                style={[
                  styles.progressBar,
                  {
                    backgroundColor: i === activeIdx ? currentSlide.color : colors.border,
                    flex: i === activeIdx ? 2 : 1,
                  }
                ]}
              />
            ))}
          </View>

          {/* Main Slide Carousel Area */}
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >
            <View style={styles.slideContainer}>
              {/* Icon Container */}
              <View style={[styles.iconWrapper, { backgroundColor: `${currentSlide.color}18` }]}>
                <Icon color={currentSlide.color} size={36} />
              </View>

              {/* Tagline */}
              <ThemedText style={[styles.tagline, { color: currentSlide.color }]}>
                {currentSlide.tagline.toUpperCase()}
              </ThemedText>

              {/* Title */}
              <ThemedText style={styles.title}>{currentSlide.title}</ThemedText>

              {/* Description */}
              <ThemedText type="secondary" style={styles.description}>
                {currentSlide.description}
              </ThemedText>

              {/* Bullets */}
              <View style={styles.bulletsWrapper}>
                {currentSlide.bullets.map((bullet, idx) => (
                  <View key={idx} style={styles.bulletRow}>
                    <LucideCheckCircle2 color={currentSlide.color} size={14} style={styles.bulletCheck} />
                    <ThemedText type="secondary" style={styles.bulletText}>
                      {bullet}
                    </ThemedText>
                  </View>
                ))}
              </View>
            </View>
          </ScrollView>

          {/* Footer Actions */}
          <View style={[styles.footer, { borderTopColor: colors.border }]}>
            <TouchableOpacity
              onPress={handlePrev}
              disabled={activeIdx === 0}
              style={[
                styles.navButton,
                { borderColor: colors.border, opacity: activeIdx === 0 ? 0.3 : 1 }
              ]}
            >
              <LucideChevronLeft color={colors.primary} size={18} />
              <ThemedText style={styles.navButtonText}>Back</ThemedText>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleNext}
              style={[styles.actionButton, { backgroundColor: colors.accent }]}
            >
              <ThemedText style={styles.actionButtonText}>
                {activeIdx === SLIDES.length - 1 ? 'Get Started' : 'Next'}
              </ThemedText>
              <LucideChevronRight color="#fff" size={18} />
            </TouchableOpacity>
          </View>
        </MotiView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxHeight: '80%',
    borderRadius: 24,
    borderWidth: 1,
    overflow: 'hidden',
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 15,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
  },
  headerTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  closeButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 4,
    marginBottom: 20,
  },
  progressBar: {
    height: 4,
    borderRadius: 2,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  slideContainer: {
    alignItems: 'center',
  },
  iconWrapper: {
    width: 72,
    height: 72,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  tagline: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 12,
  },
  description: {
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 20,
  },
  bulletsWrapper: {
    alignSelf: 'stretch',
    backgroundColor: 'rgba(0, 0, 0, 0.02)',
    padding: 16,
    borderRadius: 16,
    gap: 12,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  bulletCheck: {
    marginTop: 2,
    flexShrink: 0,
  },
  bulletText: {
    fontSize: 12,
    lineHeight: 18,
    flex: 1,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  navButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
  },
  navButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 20,
    paddingRight: 16,
    paddingVertical: 10,
    borderRadius: 12,
    gap: 4,
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
});
