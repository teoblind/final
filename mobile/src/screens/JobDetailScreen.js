import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, fontSize } from '../constants/theme';

const DEMO_JOB = {
  id: 'PRJ-2024-0847',
  projectName: 'Riverside Medical Center — Phase 2',
  generalContractor: 'Hensel Phelps Construction',
  status: 'In Progress',
  progress: 0.68,
  startDate: '2024-09-15',
  estimatedCompletion: '2026-06-30',
  contractValue: 4250000,
  billedToDate: 2890000,
  remainingBalance: 1360000,
  metrics: {
    rfis: { count: 24, open: 7, label: 'RFIs' },
    submittals: { count: 48, pending: 12, label: 'Submittals' },
    safetyDays: { count: 147, label: 'Safe Days' },
  },
  fieldReports: [
    {
      id: 'FR-047',
      date: '2026-03-07',
      author: 'Mike Torres',
      summary: 'Completed 3rd floor MEP rough-in. Electrical conduit run 85% complete.',
      weather: 'Clear, 72\u00B0F',
    },
    {
      id: 'FR-046',
      date: '2026-03-06',
      author: 'Sarah Chen',
      summary: 'Concrete pour for level 4 slab. 120 CY placed, no issues.',
      weather: 'Partly Cloudy, 68\u00B0F',
    },
    {
      id: 'FR-045',
      date: '2026-03-05',
      author: 'Mike Torres',
      summary: 'Structural steel erection ongoing. 6 bays completed, crane repositioned.',
      weather: 'Clear, 74\u00B0F',
    },
    {
      id: 'FR-044',
      date: '2026-03-04',
      author: 'James Rivera',
      summary: 'Fire suppression installation on floors 1-2. Inspection passed.',
      weather: 'Rain, 62\u00B0F',
    },
  ],
  changeOrders: [
    {
      id: 'CO-012',
      title: 'Additional Structural Reinforcement — East Wing',
      amount: 87500,
      status: 'approved',
    },
    {
      id: 'CO-011',
      title: 'HVAC Redesign for Server Room',
      amount: 42300,
      status: 'pending',
    },
    {
      id: 'CO-010',
      title: 'Owner Credit — Flooring Spec Change',
      amount: -15000,
      status: 'approved',
    },
    {
      id: 'CO-009',
      title: 'Elevator Pit Waterproofing',
      amount: 28900,
      status: 'approved',
    },
  ],
};

const formatCurrency = (val) => {
  const abs = Math.abs(val);
  if (abs >= 1000000) return `$${(val / 1000000).toFixed(2)}M`;
  if (abs >= 1000) return `$${(val / 1000).toFixed(0)}K`;
  return `$${val.toLocaleString()}`;
};

const StatusBadge = ({ status }) => {
  const map = {
    'In Progress': { bg: colors.accentBg, text: colors.accent },
    approved: { bg: colors.greenBg, text: colors.green },
    pending: { bg: colors.warmBg, text: colors.warm },
    rejected: { bg: colors.dangerBg, text: colors.danger },
    Completed: { bg: colors.greenBg, text: colors.green },
  };
  const s = map[status] || map.pending;
  return (
    <View style={[styles.statusBadge, { backgroundColor: s.bg }]}>
      <Text style={[styles.statusBadgeText, { color: s.text }]}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Text>
    </View>
  );
};

const MetricCard = ({ icon, iconColor, label, value, subtitle }) => (
  <View style={styles.metricCard}>
    <View style={styles.metricTop}>
      <Ionicons name={icon} size={20} color={iconColor} />
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
    <Text style={styles.metricValue}>{value}</Text>
    {subtitle ? <Text style={styles.metricSubtitle}>{subtitle}</Text> : null}
  </View>
);

export default function JobDetailScreen({ route }) {
  const job = DEMO_JOB;
  const [expandedReport, setExpandedReport] = useState(null);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header Card */}
      <View style={styles.headerCard}>
        <Text style={styles.projectName}>{job.projectName}</Text>
        <Text style={styles.gcName}>{job.generalContractor}</Text>

        <View style={styles.headerRow}>
          <StatusBadge status={job.status} />
          <Text style={styles.projectId}>{job.id}</Text>
        </View>

        <View style={styles.progressSection}>
          <View style={styles.progressHeader}>
            <Text style={styles.progressLabel}>Overall Progress</Text>
            <Text style={styles.progressPercent}>{Math.round(job.progress * 100)}%</Text>
          </View>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${job.progress * 100}%` }]} />
          </View>
          <View style={styles.progressDates}>
            <Text style={styles.dateText}>Start: {job.startDate}</Text>
            <Text style={styles.dateText}>Est. Complete: {job.estimatedCompletion}</Text>
          </View>
        </View>
      </View>

      {/* Metrics */}
      <View style={styles.metricsRow}>
        <MetricCard
          icon="document-text-outline"
          iconColor={colors.accent}
          label={job.metrics.rfis.label}
          value={job.metrics.rfis.count}
          subtitle={`${job.metrics.rfis.open} open`}
        />
        <MetricCard
          icon="clipboard-outline"
          iconColor={colors.warm}
          label={job.metrics.submittals.label}
          value={job.metrics.submittals.count}
          subtitle={`${job.metrics.submittals.pending} pending`}
        />
        <MetricCard
          icon="shield-checkmark-outline"
          iconColor={colors.green}
          label={job.metrics.safetyDays.label}
          value={job.metrics.safetyDays.count}
        />
      </View>

      {/* Financial Summary */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Financial Summary</Text>
      </View>
      <View style={styles.financialCard}>
        <View style={styles.financialRow}>
          <Text style={styles.financialLabel}>Contract Value</Text>
          <Text style={styles.financialValue}>{formatCurrency(job.contractValue)}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.financialRow}>
          <Text style={styles.financialLabel}>Billed to Date</Text>
          <Text style={[styles.financialValue, { color: colors.accent }]}>
            {formatCurrency(job.billedToDate)}
          </Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.financialRow}>
          <Text style={styles.financialLabel}>Remaining Balance</Text>
          <Text style={[styles.financialValue, { color: colors.green }]}>
            {formatCurrency(job.remainingBalance)}
          </Text>
        </View>
      </View>

      {/* Field Reports */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Field Reports</Text>
        <View style={styles.sectionCountBadge}>
          <Text style={styles.sectionCount}>{job.fieldReports.length}</Text>
        </View>
      </View>
      {job.fieldReports.map((report) => (
        <TouchableOpacity
          key={report.id}
          style={styles.reportCard}
          onPress={() =>
            setExpandedReport(expandedReport === report.id ? null : report.id)
          }
          activeOpacity={0.7}
        >
          <View style={styles.reportHeader}>
            <View style={styles.reportLeft}>
              <Text style={styles.reportId}>{report.id}</Text>
              <Text style={styles.reportDate}>{report.date}</Text>
            </View>
            <View style={styles.reportRight}>
              <Text style={styles.reportAuthor}>{report.author}</Text>
              <Ionicons
                name={expandedReport === report.id ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={colors.textMuted}
              />
            </View>
          </View>
          {expandedReport === report.id && (
            <View style={styles.reportBody}>
              <Text style={styles.reportSummary}>{report.summary}</Text>
              <View style={styles.weatherRow}>
                <Ionicons name="partly-sunny-outline" size={14} color={colors.textTertiary} />
                <Text style={styles.weatherText}>{report.weather}</Text>
              </View>
            </View>
          )}
        </TouchableOpacity>
      ))}

      {/* Change Orders */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Change Orders</Text>
        <View style={styles.sectionCountBadge}>
          <Text style={styles.sectionCount}>{job.changeOrders.length}</Text>
        </View>
      </View>
      {job.changeOrders.map((co) => (
        <View key={co.id} style={styles.coCard}>
          <View style={styles.coTop}>
            <View style={styles.coBadge}>
              <Text style={styles.coBadgeText}>{co.id}</Text>
            </View>
            <StatusBadge status={co.status} />
          </View>
          <Text style={styles.coTitle} numberOfLines={2}>
            {co.title}
          </Text>
          <Text
            style={[
              styles.coAmount,
              { color: co.amount >= 0 ? colors.green : colors.danger },
            ]}
          >
            {co.amount >= 0 ? '+' : ''}
            {formatCurrency(co.amount)}
          </Text>
        </View>
      ))}

      <View style={{ height: spacing.xl }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: spacing.lg,
  },
  headerCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  projectName: {
    fontSize: fontSize.xxl,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  gcName: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  projectId: {
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: colors.textTertiary,
  },
  progressSection: {},
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  progressLabel: {
    fontSize: fontSize.sm,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  progressPercent: {
    fontSize: fontSize.md,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: colors.accent,
  },
  progressBar: {
    height: 8,
    backgroundColor: colors.surfaceInset,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.accent,
    borderRadius: 4,
  },
  progressDates: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  dateText: {
    fontSize: 11,
    color: colors.textTertiary,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  metricCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: spacing.md,
  },
  metricTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  metricLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.textMuted,
  },
  metricValue: {
    fontSize: 28,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: colors.text,
  },
  metricSubtitle: {
    fontSize: 11,
    color: colors.textTertiary,
    marginTop: 2,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.text,
  },
  sectionCountBadge: {
    backgroundColor: colors.surfaceInset,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  sectionCount: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
  },
  financialCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  financialRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
  },
  financialLabel: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  financialValue: {
    fontSize: fontSize.md,
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: colors.text,
  },
  divider: {
    height: 1,
    backgroundColor: colors.borderLight,
  },
  reportCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  reportHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  reportLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  reportId: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: colors.accent,
  },
  reportDate: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  reportRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  reportAuthor: {
    fontSize: fontSize.sm,
    color: colors.textTertiary,
  },
  reportBody: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  reportSummary: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: 8,
  },
  weatherRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  weatherText: {
    fontSize: 12,
    color: colors.textTertiary,
  },
  coCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  coTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  coBadge: {
    backgroundColor: colors.accentBg,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  coBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: colors.accent,
  },
  coTitle: {
    fontSize: fontSize.md,
    fontWeight: '500',
    color: colors.text,
    marginBottom: 6,
  },
  coAmount: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
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
});
