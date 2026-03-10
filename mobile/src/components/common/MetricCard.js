import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, fontSize as fs } from '../../constants/theme';

export default function MetricCard({ icon, iconColor, iconBg, label, value, style }) {
  return (
    <View style={[styles.card, style]}>
      <View style={[styles.iconWrap, { backgroundColor: iconBg || iconColor + '14' }]}>
        <Ionicons name={icon} size={16} color={iconColor} />
      </View>
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  value: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    lineHeight: 32,
  },
  label: {
    color: colors.textTertiary,
    fontSize: fs.sm,
    fontWeight: '500',
    marginTop: 4,
  },
});
