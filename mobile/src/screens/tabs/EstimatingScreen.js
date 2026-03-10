import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import * as api from '../../services/api';
import { daysUntil } from '../../utils/time';

const C = {
  bg: '#fafaf8',
  surface: '#ffffff',
  surfaceInset: '#f5f4f0',
  border: '#e8e6e1',
  borderLight: '#f0eeea',
  accent: '#1e3a5f',
  accentBg: '#eef3f9',
  accentDot: '#3b82f6',
  green: '#1a6b3c',
  greenBg: '#edf7f0',
  warm: '#b8860b',
  warmBg: '#fdf6e8',
  danger: '#c0392b',
  dangerBg: '#fdeaea',
  purple: '#7c3aed',
  purpleBg: '#f3f0ff',
  text: '#111110',
  textSecondary: '#333330',
  textMuted: '#6b6b65',
  textTertiary: '#9a9a92',
  textFaint: '#c5c5bc',
};

const FILTERS = ['All', 'New', 'Estimated', 'Sent'];

const STATUS_STYLES = {
  new: { bg: C.accentBg, color: C.accent },
  estimated: { bg: C.greenBg, color: C.green },
  sent: { bg: C.warmBg, color: C.warm },
  won: { bg: C.greenBg, color: C.green },
  lost: { bg: C.dangerBg, color: C.danger },
};

const DEMO_RFQS = [
  { id: 1, project: 'Bishop Arts Mixed-Use', gc: 'Hensel Phelps', scope: 'SOG 45,000 SF, Curb & Gutter 2,800 LF', due: '2026-03-12', status: 'new', value: '$847,300' },
  { id: 2, project: 'I-35 Retaining Walls', gc: 'Austin Bridge & Road', scope: 'Cast-in-place walls 12,000 SF', due: '2026-03-10', status: 'new', value: '$1,200,000' },
  { id: 3, project: 'Baylor Scott & White Clinic', gc: 'JE Dunn', scope: 'Post-tension deck 28,000 SF', due: '2026-03-15', status: 'estimated', value: '$534,000' },
  { id: 4, project: 'DFW Airport Terminal F', gc: 'McCarthy Building', scope: 'Elevated deck + piers, 65,000 SF', due: '2026-03-20', status: 'estimated', value: '$2,100,000' },
  { id: 5, project: 'Cedar Hill Townhomes', gc: 'David Weekley', scope: 'Foundations 24 units, driveways', due: '2026-03-08', status: 'sent', value: '$380,000' },
  { id: 6, project: 'Legacy West Phase III', gc: 'Balfour Beatty', scope: 'Parking garage foundations + slabs', due: '2026-03-25', status: 'new', value: '$1,450,000' },
];

function getDueColor(dueDate) {
  const days = daysUntil(dueDate);
  if (days < 3) return C.danger;
  if (days < 7) return C.warm;
  return C.green;
}

function formatDue(dueDate) {
  const days = daysUntil(dueDate);
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return `${days}d left`;
}

export default function EstimatingScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [rfqs, setRfqs] = useState(DEMO_RFQS);
  const [activeFilter, setActiveFilter] = useState('All');
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await api.getEstimateInbox();
      if (res && res.length > 0) {
        setRfqs(res);
      }
    } catch {
      // fall back to demo data
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  const filteredRfqs = activeFilter === 'All'
    ? rfqs
    : rfqs.filter((r) => r.status.toLowerCase() === activeFilter.toLowerCase());

  const openCount = rfqs.filter((r) => ['new', 'estimated', 'sent'].includes(r.status)).length;
  const pipeline = rfqs.reduce((sum, r) => {
    const num = parseFloat(r.value.replace(/[$,]/g, ''));
    return sum + (isNaN(num) ? 0 : num);
  }, 0);
  const pipelineStr = pipeline >= 1000000
    ? `$${(pipeline / 1000000).toFixed(1)}M`
    : `$${(pipeline / 1000).toFixed(0)}K`;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Estimating</Text>
      </View>

      {/* Filter Chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
      >
        {FILTERS.map((filter) => {
          const isActive = activeFilter === filter;
          return (
            <TouchableOpacity
              key={filter}
              style={[styles.filterChip, isActive && styles.filterChipActive]}
              onPress={() => setActiveFilter(filter)}
            >
              <Text style={[styles.filterChipText, isActive && styles.filterChipTextActive]}>
                {filter}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Stats Bar */}
      <View style={styles.statsBar}>
        <Text style={styles.statsText}>{openCount} Open RFQs</Text>
        <Text style={styles.statsDivider}>|</Text>
        <Text style={styles.statsText}>68% Win Rate</Text>
        <Text style={styles.statsDivider}>|</Text>
        <Text style={styles.statsText}>{pipelineStr} Pipeline</Text>
      </View>

      {/* RFQ List */}
      <ScrollView
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={C.accent}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <ActivityIndicator color={C.accent} style={{ marginVertical: 40 }} />
        ) : filteredRfqs.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="document-text-outline" size={40} color={C.textFaint} />
            <Text style={styles.emptyText}>No RFQs match this filter</Text>
          </View>
        ) : (
          filteredRfqs.map((rfq) => {
            const dueColor = getDueColor(rfq.due);
            const ss = STATUS_STYLES[rfq.status] || STATUS_STYLES.new;
            return (
              <TouchableOpacity
                key={rfq.id}
                style={styles.rfqCard}
                onPress={() => navigation.navigate('Chat', {
                  agentId: 'estimating',
                  context: { projectId: rfq.id, project: rfq.project },
                })}
                activeOpacity={0.7}
              >
                <View style={styles.rfqTopRow}>
                  <View style={{ flex: 1, marginRight: 12 }}>
                    <Text style={styles.rfqProject} numberOfLines={1}>{rfq.project}</Text>
                    <Text style={styles.rfqGc}>{rfq.gc}</Text>
                  </View>
                  <Text style={styles.rfqValue}>{rfq.value}</Text>
                </View>

                <Text style={styles.rfqScope} numberOfLines={1}>{rfq.scope}</Text>

                <View style={styles.rfqBottomRow}>
                  <View style={[styles.statusBadge, { backgroundColor: ss.bg }]}>
                    <Text style={[styles.statusBadgeText, { color: ss.color }]}>
                      {rfq.status.charAt(0).toUpperCase() + rfq.status.slice(1)}
                    </Text>
                  </View>
                  <View style={styles.rfqDueWrap}>
                    <Ionicons name="time-outline" size={13} color={dueColor} />
                    <Text style={[styles.rfqDue, { color: dueColor }]}>
                      {formatDue(rfq.due)}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            );
          })
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.borderLight,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: C.text,
    fontFamily: 'Georgia',
  },
  filterRow: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: C.surfaceInset,
    marginRight: 4,
  },
  filterChipActive: {
    backgroundColor: C.accent,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: C.textMuted,
  },
  filterChipTextActive: {
    color: '#ffffff',
  },
  statsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: C.borderLight,
    gap: 8,
  },
  statsText: {
    fontSize: 11,
    fontFamily: 'Courier',
    color: C.textMuted,
    letterSpacing: 0.3,
  },
  statsDivider: {
    fontSize: 11,
    color: C.textFaint,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 40,
  },
  rfqCard: {
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  rfqTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  rfqProject: {
    fontSize: 15,
    fontWeight: '700',
    color: C.text,
    marginBottom: 2,
  },
  rfqGc: {
    fontSize: 13,
    color: C.textSecondary,
    fontWeight: '500',
  },
  rfqValue: {
    fontSize: 15,
    fontWeight: '600',
    color: C.text,
    fontFamily: 'Courier',
  },
  rfqScope: {
    fontSize: 12,
    color: C.textMuted,
    marginTop: 6,
    marginBottom: 10,
  },
  rfqBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  rfqDueWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  rfqDue: {
    fontSize: 12,
    fontWeight: '600',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    color: C.textMuted,
  },
});
