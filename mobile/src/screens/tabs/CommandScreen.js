import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, fontSize, shadows } from '../../constants/theme';
import { AGENTS } from '../../constants/agents';
import * as api from '../../services/api';

// ---------------------------------------------------------------------------
// Demo Data
// ---------------------------------------------------------------------------

const DEMO_KPIS = [
  { label: 'Open RFQs', value: '8', icon: 'clipboard-outline', color: colors.accent, bg: colors.accentBg },
  { label: 'Win Rate', value: '68%', icon: 'trending-up-outline', color: colors.green, bg: colors.greenBg },
  { label: 'Avg Margin', value: '14.2%', icon: 'logo-usd', color: colors.warm, bg: colors.warmBg },
  { label: 'Active Jobs', value: '12', icon: 'business-outline', color: colors.purple, bg: colors.purpleBg },
];

const DEMO_APPROVALS = [
  {
    id: '1',
    dotColor: colors.accentDot,
    title: 'Estimate: Bishop Arts Mixed-Use',
    time: '20m',
    description: 'Auto-generated estimate ready for review — $847,300 total, 92% confidence score.',
  },
  {
    id: '2',
    dotColor: colors.green,
    title: 'Email Draft: Hensel Phelps RFQ Response',
    time: '1h',
    description: 'Drafted reply to I-35 Retaining Walls RFQ. Includes pricing summary and timeline.',
  },
  {
    id: '3',
    dotColor: colors.warm,
    title: 'Field Report Flag: Rock at 28\'',
    time: '2h',
    description: 'Carlos flagged unexpected rock at 28\' depth on Westpark Retail. May affect foundation budget.',
  },
];

const DEMO_INSIGHTS = [
  {
    id: '1',
    unread: true,
    agent: 'ESTIMATING',
    agentColor: colors.accent,
    agentBg: colors.accentBg,
    type: 'PATTERN',
    time: '3h',
    title: 'Sidewalk pricing consistently adjusted up',
    body: [
      { text: 'You\'ve adjusted sidewalk pricing from ', bold: false },
      { text: '$10.35 to $11.00', bold: true },
      { text: ' on the last 4 estimates. Want me to update the base pricing table?', bold: false },
    ],
    primaryAction: 'Update Pricing',
    secondaryAction: 'Dismiss',
  },
  {
    id: '2',
    unread: false,
    agent: 'HIVEMIND',
    agentColor: colors.green,
    agentBg: colors.greenBg,
    type: 'QUESTION',
    time: '5h',
    title: 'TXI raised concrete pricing this month',
    body: [
      { text: 'I detected a price increase from ', bold: false },
      { text: '$145 to $149/CY', bold: true },
      { text: ' for 3000 PSI on the latest TXI invoice. Your last 2 estimates used the old price.', bold: false },
    ],
    primaryAction: 'Update to $149',
    secondaryAction: 'Check with TXI first',
  },
  {
    id: '3',
    unread: false,
    agent: 'FIELD',
    agentColor: colors.warm,
    agentBg: colors.warmBg,
    type: 'ALERT',
    time: 'Yesterday',
    title: 'Westpark Retail rebar usage 18% over estimate',
    body: [
      { text: 'Job 4521 has used ', bold: false },
      { text: '2,400 LF', bold: true },
      { text: ' of #4 rebar against a 2,000 LF estimate with 40% of work remaining. Projected overrun: ', bold: false },
      { text: '$4,200', bold: true },
      { text: '.', bold: false },
    ],
    primaryAction: 'View Job Detail',
    secondaryAction: 'Acknowledge',
  },
];

const DEMO_QUICK_ACTIONS = [
  { label: 'New Estimate', icon: 'add', color: colors.accent, bg: colors.accentBg },
  { label: 'Search Files', icon: 'search', color: colors.warm, bg: colors.warmBg },
  { label: 'Ask DACP', icon: 'chatbubble-outline', color: colors.purple, bg: colors.purpleBg },
];

const DEMO_ACTIVITY = [
  {
    id: '1',
    agent: 'Estimating Bot',
    icon: 'calculator-outline',
    color: colors.accent,
    bg: colors.accentBg,
    description: 'generated estimate for Bishop Arts Mixed-Use — $847,300 at 92% confidence',
    time: '20m ago',
  },
  {
    id: '2',
    agent: 'Email Agent',
    icon: 'mail-outline',
    color: colors.green,
    bg: colors.greenBg,
    description: 'drafted response to Hensel Phelps RFQ for I-35 Retaining Walls',
    time: '1h ago',
  },
  {
    id: '3',
    agent: 'Field Reporter',
    icon: 'construct-outline',
    color: colors.warm,
    bg: colors.warmBg,
    description: 'Carlos submitted daily log for Westpark Retail. 52 CY poured, 6 finishers.',
    time: '2h ago',
  },
  {
    id: '4',
    agent: 'Meeting Bot',
    icon: 'mic-outline',
    color: colors.purple,
    bg: colors.purpleBg,
    description: 'transcribed GC coordination call — Turner, 38 min. 2 action items.',
    time: '4h ago',
  },
  {
    id: '5',
    agent: 'Estimating Bot',
    icon: 'send-outline',
    color: colors.accent,
    bg: colors.accentBg,
    description: 'sent approved quote to DPR Construction — TMC Building 7, $445,000',
    time: '6h ago',
  },
  {
    id: '6',
    agent: 'Lead Engine',
    icon: 'people-outline',
    color: colors.green,
    bg: colors.greenBg,
    description: 'discovered 6 new GC contacts in Dallas-Fort Worth area',
    time: '8h ago',
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CommandScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const [refreshing, setRefreshing] = useState(false);
  const [kpis, setKpis] = useState(DEMO_KPIS);
  const [approvals, setApprovals] = useState(DEMO_APPROVALS);
  const [insights, setInsights] = useState(DEMO_INSIGHTS);
  const [activity, setActivity] = useState(DEMO_ACTIVITY);

  const loadData = useCallback(async () => {
    try {
      const [kpiData, approvalData, insightData, activityData] = await Promise.all([
        api.getKPIs?.().catch(() => null),
        api.getPendingApprovals?.().catch(() => null),
        api.getAgentInsights?.().catch(() => null),
        api.getRecentActivity?.().catch(() => null),
      ]);
      if (kpiData) setKpis(kpiData);
      if (approvalData) setApprovals(approvalData);
      if (insightData) setInsights(insightData);
      if (activityData) setActivity(activityData);
    } catch {
      // fallback to demo data
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  // -------------------------------------------------------------------------
  // Header
  // -------------------------------------------------------------------------
  const renderHeader = () => (
    <View style={styles.header}>
      <View style={styles.headerLeft}>
        <View style={styles.headerMark}>
          <Text style={styles.headerMarkText}>D</Text>
        </View>
        <Text style={styles.headerTitle}>Command</Text>
      </View>
      <View style={styles.headerRight}>
        <TouchableOpacity style={styles.bellButton} activeOpacity={0.7}>
          <Ionicons name="notifications-outline" size={18} color={colors.text} />
          <View style={styles.bellBadge}>
            <Text style={styles.bellBadgeText}>3</Text>
          </View>
        </TouchableOpacity>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>DC</Text>
        </View>
      </View>
    </View>
  );

  // -------------------------------------------------------------------------
  // KPI Grid
  // -------------------------------------------------------------------------
  const renderKPIGrid = () => (
    <View style={styles.kpiGrid}>
      {kpis.map((kpi, i) => (
        <View key={i} style={styles.kpiCard}>
          <View style={[styles.kpiIcon, { backgroundColor: kpi.bg }]}>
            <Ionicons name={kpi.icon} size={17} color={kpi.color} />
          </View>
          <Text style={styles.kpiValue}>{kpi.value}</Text>
          <Text style={styles.kpiLabel}>{kpi.label}</Text>
        </View>
      ))}
    </View>
  );

  // -------------------------------------------------------------------------
  // Pending Approvals
  // -------------------------------------------------------------------------
  const renderApprovals = () => (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionHeaderLeft}>
          <Text style={styles.sectionTitle}>Pending Approvals</Text>
          <View style={styles.sectionBadge}>
            <Text style={styles.sectionBadgeText}>3</Text>
          </View>
        </View>
        <TouchableOpacity activeOpacity={0.7}>
          <Text style={styles.viewAllLink}>View All</Text>
        </TouchableOpacity>
      </View>
      {approvals.map((item) => (
        <View key={item.id} style={styles.approvalCard}>
          <View style={styles.approvalTop}>
            <View style={[styles.approvalDot, { backgroundColor: item.dotColor }]} />
            <Text style={styles.approvalTitle} numberOfLines={1}>{item.title}</Text>
            <Text style={styles.approvalTime}>{item.time}</Text>
          </View>
          <Text style={styles.approvalDesc}>{item.description}</Text>
          <View style={styles.approvalActions}>
            <TouchableOpacity style={styles.rejectButton} activeOpacity={0.7}>
              <Text style={styles.rejectButtonText}>Reject</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.approveButton} activeOpacity={0.7}>
              <Text style={styles.approveButtonText}>Approve</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}
    </View>
  );

  // -------------------------------------------------------------------------
  // Agent Insights
  // -------------------------------------------------------------------------
  const renderInsightBody = (bodyParts) => (
    <Text style={styles.insightBody}>
      {bodyParts.map((part, i) => (
        <Text key={i} style={part.bold ? styles.insightBodyBold : undefined}>
          {part.text}
        </Text>
      ))}
    </Text>
  );

  const renderInsights = () => (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Agent Insights</Text>
      </View>
      {insights.map((insight) => (
        <View key={insight.id} style={styles.insightCard}>
          <View style={styles.insightHeader}>
            {insight.unread && <View style={styles.unreadDot} />}
            <View style={[styles.agentBadge, { backgroundColor: insight.agentBg }]}>
              <Text style={[styles.agentBadgeText, { color: insight.agentColor }]}>
                {insight.agent}
              </Text>
            </View>
            <Text style={styles.insightType}>{insight.type}</Text>
            <Text style={styles.insightTime}>{insight.time}</Text>
          </View>
          <Text style={styles.insightTitle}>{insight.title}</Text>
          {renderInsightBody(insight.body)}
          <View style={styles.insightActions}>
            <TouchableOpacity style={styles.primaryActionButton} activeOpacity={0.7}>
              <Text style={styles.primaryActionText}>{insight.primaryAction}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryActionButton} activeOpacity={0.7}>
              <Text style={styles.secondaryActionText}>{insight.secondaryAction}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}
    </View>
  );

  // -------------------------------------------------------------------------
  // Quick Actions
  // -------------------------------------------------------------------------
  const renderQuickActions = () => (
    <View style={styles.section}>
      <View style={styles.quickActionsRow}>
        {DEMO_QUICK_ACTIONS.map((action, i) => (
          <TouchableOpacity key={i} style={styles.quickActionCard} activeOpacity={0.7}>
            <View style={[styles.quickActionIcon, { backgroundColor: action.bg }]}>
              <Ionicons name={action.icon} size={20} color={action.color} />
            </View>
            <Text style={styles.quickActionLabel}>{action.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  // -------------------------------------------------------------------------
  // Recent Activity
  // -------------------------------------------------------------------------
  const renderActivity = () => (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Recent Activity</Text>
        <TouchableOpacity activeOpacity={0.7}>
          <Text style={styles.viewAllLink}>Audit Trail</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.activityList}>
        {activity.map((item, i) => (
          <View
            key={item.id}
            style={[
              styles.activityItem,
              i < activity.length - 1 && styles.activityItemBorder,
            ]}
          >
            <View style={[styles.activityIcon, { backgroundColor: item.bg }]}>
              <Ionicons name={item.icon} size={14} color={item.color} />
            </View>
            <View style={styles.activityContent}>
              <Text style={styles.activityText}>
                <Text style={styles.activityAgent}>{item.agent}</Text>
                {' '}{item.description}
              </Text>
              <Text style={styles.activityTime}>{item.time}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        }
      >
        {renderHeader()}
        {renderKPIGrid()}
        {renderApprovals()}
        {renderInsights()}
        {renderQuickActions()}
        {renderActivity()}
        <View style={{ height: 100 }} />
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  // Layout
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 12,
    paddingBottom: 20,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerMark: {
    width: 32,
    height: 32,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  headerMarkText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.accent,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '400',
    color: colors.text,
    letterSpacing: -0.3,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  bellButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    backgroundColor: colors.danger,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#ffffff',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.accentBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.accent,
  },

  // KPI Grid
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 28,
  },
  kpiCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 14,
  },
  kpiIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  kpiValue: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
    fontVariant: ['tabular-nums'],
    marginBottom: 2,
  },
  kpiLabel: {
    fontSize: 12,
    color: colors.textTertiary,
    fontWeight: '500',
  },

  // Sections
  section: {
    marginBottom: 28,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  sectionBadge: {
    backgroundColor: colors.danger,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    minWidth: 18,
    alignItems: 'center',
  },
  sectionBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#ffffff',
  },
  viewAllLink: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.accent,
  },

  // Approval Cards
  approvalCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  approvalTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  approvalDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 10,
  },
  approvalTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  approvalTime: {
    fontSize: 11,
    color: colors.textFaint,
    fontVariant: ['tabular-nums'],
    marginLeft: 8,
  },
  approvalDesc: {
    fontSize: 12,
    color: colors.textTertiary,
    lineHeight: 17,
    marginLeft: 18,
    marginBottom: 12,
  },
  approvalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  rejectButton: {
    backgroundColor: colors.surfaceInset,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 9,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  rejectButtonText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textTertiary,
  },
  approveButton: {
    backgroundColor: colors.accent,
    borderRadius: 9,
    paddingVertical: 8,
    paddingHorizontal: 20,
  },
  approveButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#ffffff',
  },

  // Insight Cards
  insightCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  insightHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  unreadDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.accentDot,
    marginRight: 8,
  },
  agentBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 5,
    marginRight: 8,
  },
  agentBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  insightType: {
    fontSize: 9,
    fontWeight: '600',
    color: colors.textFaint,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  insightTime: {
    fontSize: 11,
    color: colors.textFaint,
    fontVariant: ['tabular-nums'],
    marginLeft: 'auto',
  },
  insightTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 6,
  },
  insightBody: {
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 20.8,
    marginBottom: 14,
  },
  insightBodyBold: {
    fontWeight: '600',
    color: colors.text,
  },
  insightActions: {
    flexDirection: 'row',
    gap: 8,
  },
  primaryActionButton: {
    backgroundColor: colors.accent,
    borderRadius: 9,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  primaryActionText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#ffffff',
  },
  secondaryActionButton: {
    backgroundColor: colors.surfaceInset,
    borderRadius: 9,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  secondaryActionText: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textTertiary,
  },

  // Quick Actions
  quickActionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  quickActionCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    gap: 10,
  },
  quickActionIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickActionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },

  // Recent Activity
  activityList: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    overflow: 'hidden',
  },
  activityItem: {
    flexDirection: 'row',
    padding: 14,
    alignItems: 'flex-start',
  },
  activityItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  activityIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    marginTop: 1,
  },
  activityContent: {
    flex: 1,
  },
  activityText: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  activityAgent: {
    fontWeight: '700',
    color: colors.text,
  },
  activityTime: {
    fontSize: 10,
    color: colors.textFaint,
    fontVariant: ['tabular-nums'],
    marginTop: 4,
  },
});
