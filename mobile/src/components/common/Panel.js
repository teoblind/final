import React from 'react';
import { View, StyleSheet } from 'react-native';
import { colors, radius, spacing } from '../../constants/theme';

export default function Panel({ children, style, noPadding }) {
  return (
    <View style={[styles.panel, noPadding && { padding: 0 }, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
});
