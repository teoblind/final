import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, radius, fontSize as fs } from '../../constants/theme';

const STATUS_STYLES = {
  new: { bg: '#eef3f9', text: '#1e3a5f' },
  estimated: { bg: '#edf7f0', text: '#1a6b3c' },
  sent: { bg: '#fdf6e8', text: '#b8860b' },
  won: { bg: '#edf7f0', text: '#1a6b3c' },
  lost: { bg: '#fbeae8', text: '#c0392b' },
  pending: { bg: '#fdf6e8', text: '#b8860b' },
  approved: { bg: '#edf7f0', text: '#1a6b3c' },
  rejected: { bg: '#fbeae8', text: '#c0392b' },
  'in progress': { bg: '#eef3f9', text: '#1e3a5f' },
  active: { bg: '#edf7f0', text: '#1a6b3c' },
};

export default function StatusBadge({ status }) {
  const key = (status || '').toLowerCase();
  const style = STATUS_STYLES[key] || { bg: colors.surfaceInset, text: colors.textTertiary };
  return (
    <View style={[styles.badge, { backgroundColor: style.bg }]}>
      <Text style={[styles.text, { color: style.text }]}>{(status || '').toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm, alignSelf: 'flex-start' },
  text: { fontSize: fs.xs, fontWeight: '700', letterSpacing: 0.5 },
});
