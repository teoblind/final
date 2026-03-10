import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getAgent } from '../constants/agents';
import { colors, spacing, radius, fontSize } from '../constants/theme';
import { timeAgo } from '../utils/time';

const FILTERS = ['All', 'Pending', 'Approved', 'Rejected'];

const TYPE_COLORS = {
  expense: { bg: colors.warmBg, text: colors.warm, label: 'Expense' },
  schedule: { bg: colors.accentBg, text: colors.accent, label: 'Schedule' },
  document: { bg: colors.purpleBg, text: colors.purple, label: 'Document' },
  purchase: { bg: colors.greenBg, text: colors.green, label: 'Purchase' },
  access: { bg: colors.dangerBg, text: colors.danger, label: 'Access' },
};

const DEMO_APPROVALS = [
  {
    id: '1',
    title: 'Q1 Marketing Budget Increase',
    description: 'Request to increase digital ad spend by $12,000 for Q1 campaign push.',
    agentId: 'finance',
    type: 'expense',
    status: 'pending',
    timestamp: new Date(Date.now() - 1000 * 60 * 25).toISOString(),
  },
  {
    id: '2',
    title: 'Vendor Contract Renewal — Acme Corp',
    description: 'Annual renewal for cloud infrastructure services. 3-year term proposed.',
    agentId: 'operations',
    type: 'purchase',
    status: 'pending',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
  },
  {
    id: '3',
    title: 'Team Offsite Schedule Change',
    description: 'Move Q2 offsite from April 15 to April 22 due to venue conflict.',
    agentId: 'scheduling',
    type: 'schedule',
    status: 'approved',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 8).toISOString(),
  },
  {
    id: '4',
    title: 'NDA Template Update',
    description: 'Updated mutual NDA template with revised IP clauses per legal review.',
    agentId: 'legal',
    type: 'document',
    status: 'approved',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
  },
  {
    id: '5',
    title: 'Production Database Access',
    description: 'Requesting read access to production analytics DB for data team.',
    agentId: 'engineering',
    type: 'access',
    status: 'rejected',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
  },
  {
    id: '6',
    title: 'Office Supply Reorder',
    description: 'Monthly reorder of printer supplies and break room essentials.',
    agentId: 'operations',
    type: 'purchase',
    status: 'pending',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
  },
];

const ApprovalCard = ({ item, onApprove, onReject }) => {
  const agent = getAgent ? getAgent(item.agentId) : null;
  const agentName = agent?.name || item.agentId || 'Agent';
  const agentColor = agent?.color || colors.accent;
  const typeInfo = TYPE_COLORS[item.type] || TYPE_COLORS.document;
  const isPending = item.status === 'pending';

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={[styles.agentDot, { backgroundColor: agentColor }]}>
          <Text style={styles.agentDotText}>{agentName.charAt(0).toUpperCase()}</Text>
        </View>
        <View style={styles.cardHeaderText}>
          <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
          <Text style={styles.cardAgent}>{agentName}</Text>
        </View>
        <View style={[styles.typeBadge, { backgroundColor: typeInfo.bg }]}>
          <Text style={[styles.typeBadgeText, { color: typeInfo.text }]}>{typeInfo.label}</Text>
        </View>
      </View>

      <Text style={styles.cardDescription} numberOfLines={2}>{item.description}</Text>

      <View style={styles.cardFooter}>
        <Text style={styles.cardTime}>{timeAgo(item.timestamp)}</Text>

        {isPending ? (
          <View style={styles.actionButtons}>
            <TouchableOpacity
              style={styles.rejectButton}
              onPress={() => onReject(item.id)}
            >
              <Text style={styles.rejectButtonText}>Reject</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.approveButton}
              onPress={() => onApprove(item.id)}
            >
              <Text style={styles.approveButtonText}>Approve</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View
            style={[
              styles.statusBadge,
              {
                backgroundColor:
                  item.status === 'approved' ? colors.greenBg : colors.dangerBg,
              },
            ]}
          >
            <Text
              style={[
                styles.statusBadgeText,
                {
                  color: item.status === 'approved' ? colors.green : colors.danger,
                },
              ]}
            >
              {item.status === 'approved' ? 'Approved' : 'Rejected'}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
};

export default function ApprovalsScreen() {
  const [filter, setFilter] = useState('All');
  const [approvals, setApprovals] = useState(DEMO_APPROVALS);

  const filtered =
    filter === 'All'
      ? approvals
      : approvals.filter((a) => a.status === filter.toLowerCase());

  const handleApprove = (id) => {
    setApprovals((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status: 'approved' } : a))
    );
  };

  const handleReject = (id) => {
    Alert.alert('Reject', 'Reject this request?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reject',
        style: 'destructive',
        onPress: () =>
          setApprovals((prev) =>
            prev.map((a) => (a.id === id ? { ...a, status: 'rejected' } : a))
          ),
      },
    ]);
  };

  const pendingCount = approvals.filter((a) => a.status === 'pending').length;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.screenTitle}>Approvals</Text>
        {pendingCount > 0 && (
          <View style={styles.pendingBadge}>
            <Text style={styles.pendingBadgeText}>{pendingCount}</Text>
          </View>
        )}
      </View>

      <View style={styles.filterRow}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.filterTab, filter === f && styles.filterTabActive]}
            onPress={() => setFilter(f)}
          >
            <Text
              style={[
                styles.filterTabText,
                filter === f && styles.filterTabTextActive,
              ]}
            >
              {f}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ApprovalCard
            item={item}
            onApprove={handleApprove}
            onReject={handleReject}
          />
        )}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="checkmark-circle-outline" size={48} color={colors.textFaint} />
            <Text style={styles.emptyText}>No {filter.toLowerCase()} approvals</Text>
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
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: 8,
  },
  screenTitle: {
    fontSize: fontSize.xxl,
    fontWeight: '700',
    color: colors.text,
  },
  pendingBadge: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    minWidth: 22,
    alignItems: 'center',
  },
  pendingBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#ffffff',
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: 8,
  },
  filterTab: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: colors.surfaceInset,
  },
  filterTabActive: {
    backgroundColor: colors.accent,
  },
  filterTabText: {
    fontSize: fontSize.sm,
    fontWeight: '500',
    color: colors.textMuted,
  },
  filterTabTextActive: {
    color: '#ffffff',
  },
  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  agentDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  agentDotText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#ffffff',
  },
  cardHeaderText: {
    flex: 1,
  },
  cardTitle: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
  },
  cardAgent: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 1,
  },
  typeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  typeBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  cardDescription: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    lineHeight: 20,
    marginBottom: 10,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTime: {
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: colors.textFaint,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  rejectButton: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: colors.surfaceInset,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rejectButtonText: {
    fontSize: fontSize.sm,
    fontWeight: '500',
    color: colors.textMuted,
  },
  approveButton: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: colors.accent,
  },
  approveButtonText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: '#ffffff',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '600',
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
