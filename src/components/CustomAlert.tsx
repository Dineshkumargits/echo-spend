import React from 'react';
import {
  Modal,
  View,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { MotiView, AnimatePresence } from 'moti';
import { useTheme } from '../theme/ThemeProvider';
import { ThemedText } from './ThemedSafeAreaView';

export interface AlertButton {
  text: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
}

interface CustomAlertProps {
  visible: boolean;
  title: string;
  message: string;
  buttons?: AlertButton[];
  onClose: () => void;
}

export const CustomAlert: React.FC<CustomAlertProps> = ({
  visible,
  title,
  message,
  buttons = [{ text: 'OK' }],
  onClose,
}) => {
  const { colors } = useTheme();

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        {/* Backdrop touch */}
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onClose}
        />

        <AnimatePresence>
          {visible && (
            <MotiView
              from={{ opacity: 0, scale: 0.9, translateY: 20 }}
              animate={{ opacity: 1, scale: 1, translateY: 0 }}
              exit={{ opacity: 0, scale: 0.9, translateY: 20 }}
              transition={{ type: 'spring', damping: 20, stiffness: 250 }}
              style={[
                styles.alertBox,
                { backgroundColor: colors.surface, borderColor: colors.border }
              ]}
            >
              {/* Header */}
              <ThemedText style={styles.title}>{title}</ThemedText>

              {/* Message */}
              <ThemedText type="secondary" style={styles.message}>
                {message}
              </ThemedText>

              {/* Buttons */}
              <View style={[styles.buttonContainer, { flexDirection: buttons.length === 2 ? 'row' : 'column' }]}>
                {buttons.map((btn, index) => {
                  const isDestructive = btn.style === 'destructive';
                  const isCancel = btn.style === 'cancel';
                  
                  let textColor = colors.accent;
                  if (isDestructive) textColor = colors.danger;
                  else if (isCancel) textColor = colors.secondary;

                  return (
                    <TouchableOpacity
                      key={index}
                      onPress={() => {
                        onClose();
                        if (btn.onPress) {
                          // Run on next tick to allow modal close animation to finish smoothly
                          setTimeout(() => btn.onPress?.(), 100);
                        }
                      }}
                      style={[
                        styles.button,
                        { 
                          borderTopColor: colors.border, 
                          borderTopWidth: 1,
                        },
                        buttons.length === 2 && index > 0 && { 
                          borderLeftColor: colors.border, 
                          borderLeftWidth: 1 
                        },
                        buttons.length !== 2 && index > 0 && {
                          borderTopColor: colors.border,
                          borderTopWidth: 1
                        }
                      ]}
                    >
                      <ThemedText
                        style={[
                          styles.btnText,
                          { color: textColor, fontWeight: isCancel ? '500' : '700' }
                        ]}
                      >
                        {btn.text}
                      </ThemedText>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </MotiView>
          )}
        </AnimatePresence>
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
    padding: 32,
  },
  alertBox: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 15,
    elevation: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    paddingTop: 24,
    paddingHorizontal: 20,
  },
  message: {
    fontSize: 13,
    textAlign: 'center',
    paddingTop: 10,
    paddingBottom: 24,
    paddingHorizontal: 20,
    lineHeight: 18,
  },
  buttonContainer: {
    width: '100%',
  },
  button: {
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  btnText: {
    fontSize: 14,
  },
});

export default CustomAlert;
