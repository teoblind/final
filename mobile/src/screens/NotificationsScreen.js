import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getAgent } from '../constants/agents';
import { colors, spacing, radius, fontSize } from '../constants/theme';
import { timeAgo } from '../utils/time';

const TYPE_DOTS = {
  info: '#3b82f6',
  warning: '#b8860b',
  action: '#7c3aed',
  success: '#1a6b3c',
  critical: '#c0392b',
};

const TYPE_ICONS = {
  info: 'information-circle-outline',
  warning: 'warning-outline',
  action: 'flash-outline',
  success: 'checkmark-circle-outline',
  critical: 'alert-circle-outline',
};

const DEMO_NOTIFICATIONS = [
  {
    id: '1',
    title: 'Monthly report generated',
    body: 'Your March financial summary is ready for review.',
    agentId: 'finance',
    type: 'success',
    read: false,
    timestamp: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
  },
  {
    id: '2',
    title: 'Contract expiring soon',
    body: 'Acme Corp vendor contract expires in 14 days. Review and renew.',
    agentId: 'legal',
    type: 'warning',
    read: false,
    timestamp: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
  },
  {
    id: '3',
    title: 'New approval request',
    body: 'Budget increase request from marketing team needs your approval.',
    agentId: 'operations',
    type: 'action',
    read: false,
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
  },
  {
    id: '4',
    title: 'System maintenance scheduled',
    body: 'Planned downtime Saturday 2:00 AM - 4:00 AM EST for database migration.',
    agentId: 'engineering',
    type: 'info',
    read: true,
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(),
  },
  {
    id: '5',
    title: 'Security alert',
    body: 'Unusual login attempt detected from unrecognized device. Please verify.',
    agentId: 'security',
    type: 'critical',
    read: false,
    timestamp: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
  },
  {
    id: '6',
    title: 'Meeting rescheduled',
    body: 'Q2 planning session moved to Thursday 3:00 PM.',
    agentId: 'scheduling',
    type: 'info',
    read: true,
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
  },
  {
    id: '7',
    title: 'Invoice paid',
    body: 'Client payment of $24,500 received and processed.',
    agentId: 'finance',
    type: 'success',
    read: true,
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 30).toISOString(),
  },
  {
    id: '8',
    title: 'Document shared with you',
    body: 'Sarah shared "Brand Guidelines v3" for your review.',
    agentId: 'operations',
    type: 'action',
    read: true,
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
  },
];

const NotificationCard = ({ item, onPress }) => {
  const agent = getAgent ? getAgent(item.agentId) : null;
  const agentName = agent?.name || item.agentId || 'System';
  const dotColor = TYPE_DOTS[item.type] || TYPE_DOTS.info;
  const icon = TYPE_ICONS[item.type] || TYPE_ICONS.info;

  return (
    <TouchableOpacity
      style={[styles.card, !item.read && styles.cardUnread]}
      onPress={() => onPress(item.id)}
      activeOpacity={0.7}
    >
      <View style={styles.cardLeft}>
        <View style={[styles.typeDot, { backgroundColor: dotColor }]} />
      </View>

      <View style={styles.cardContent}>
        <View style={styles.cardTop}>
          <Text
            style={[styles.cardTitle, !item.read && styles.cardTitleUnread]}
            numberOfLines={1}
          >
            {item.title}
          </Text>
          <Text style={styles.cardTime}>{timeAgo(item.timestamp)}</Text>
        </View>
        <Text style={styles.cardBody} numberOfLines={2}>
          {item.body}
        </Text>
        <View style={styles.cardMeta}>
          <Ionicons name={icon} size={14} color={dotColor} />
          <Text style={styles.cardAgent}>{agentName}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
};

export default function NotificationsScreen() {
  const [notifications, setNotifications] = useState(DEMO_NOTIFICATIONS);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAllRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const markRead = (id) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.screenTitle}>Notifications</Text>
          {unreadCount > 0 && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadBadgeText}>{unreadCount}</Text>
            </View>
          )}
        </View>
        {unreadCount > 0 && (
          <TouchableOpacity onPress={markAllRead}>
            <Text style={styles.markAllText}>Mark All Read</Text>
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={notifications}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <NotificationCard item={item} onPress={markRead} />
        )}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="notifications-off-outline" size={48} color={colors.textFaint} />
            <Text style={styles.emptyText}>No notifications</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  screenTitle: {
    fontSize: fontSize.xxl,
    fontWeight: '700',
    color: colors.text,
  },
  unreadBadge: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    minWidth: 22,
    alignItems: 'center',
  },
  unreadBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#ffffff',
  },
  markAllText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.accent,
  },
  list: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
  },
  card: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  cardUnread: {
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
  },
  cardLeft: {
    paddingTop: 4,
    paddingRight: 10,
  },
  typeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  cardContent: {
    flex: 1,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
    gap: 8,
  },
  cardTitle: {
    flex: 1,
    fontSize: fontSize.md,
    fontWeight: '400',
    color: colors.text,
  },
  cardTitleUnread: {
    fontWeight: '600',
  },
  cardTime: {
    fontSize: 12,
    color: colors.textFaint,
  },
  cardBody: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    lineHeight: 20,
    marginBottom: 8,
  },
  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  cardAgent: {
    fontSize: 12,
    color: colors.textTertiary,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    gap: 12,
  },
  emptyText: {
    fontSize: fontSize.md,
    color: colors.textMuted,
  },
});
