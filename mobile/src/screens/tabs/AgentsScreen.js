import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { AGENTS } from '../../constants/agents';

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
  purple: '#7c3aed',
  purpleBg: '#f3f0ff',
  text: '#111110',
  textSecondary: '#333330',
  textMuted: '#6b6b65',
  textTertiary: '#9a9a92',
  textFaint: '#c5c5bc',
};

const AGENT_COLORS = [C.accent, C.green, C.warm, C.purple, C.danger, '#0891b2'];

const ACTIVE_CHAIN = {
  name: 'RFQ-2847 Pricing',
  steps: [
    { agent: 'Hivemind (DACP Agent)', status: 'done', label: 'Always on' },
    { agent: 'Estimating Bot', status: 'running', label: 'Processing RFQ' },
    { agent: 'Email Agent', status: 'pending', label: 'Drafting response' },
  ],
};

export default function AgentsScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  const getColor = (agent, index) => agent.color || AGENT_COLORS[index % AGENT_COLORS.length];

  const getStepIcon = (status) => {
    if (status === 'done') return 'checkmark-circle';
    if (status === 'running') return 'sync-circle';
    return 'ellipse-outline';
  };

  const getStepColor = (status) => {
    if (status === 'done') return C.green;
    if (status === 'running') return C.accent;
    return C.textFaint;
  };

  const renderAgentCard = (agent, index) => {
    const color = getColor(agent, index);
    const initial = agent.name ? agent.name.charAt(0).toUpperCase() : 'A';
    const capabilities = agent.capabilities || [];

    return (
      <TouchableOpacity
        key={agent.id}
        style={styles.card}
        onPress={() =>
          navigation.navigate('Chat', {
            agentId: agent.id,
            agentName: agent.name,
            agentColor: color,
          })
        }
        activeOpacity={0.7}
      >
        <View style={styles.agentRow}>
          <View style={[styles.avatar, { backgroundColor: color + '18' }]}>
            <Text style={[styles.avatarText, { color }]}>{initial}</Text>
            {agent.online !== false && <View style={styles.onlineDot} />}
          </View>

          <View style={styles.agentInfo}>
            <Text style={styles.agentName}>{agent.name}</Text>
            <Text style={styles.agentDesc} numberOfLines={2}>
              {agent.description}
            </Text>
            {capabilities.length > 0 && (
              <View style={styles.tagsRow}>
                {capabilities.slice(0, 3).map((cap, idx) => (
                  <View key={idx} style={[styles.tag, { borderColor: color + '40' }]}>
                    <Text style={[styles.tagText, { color }]}>{cap}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          <Ionicons name="chevron-forward" size={18} color={C.textFaint} />
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Agents</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Active Chain */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionLabel}>ACTIVE CHAIN</Text>
        </View>
        <View style={styles.card}>
          <View style={styles.chainHeader}>
            <Ionicons name="git-network-outline" size={16} color={C.accent} />
            <Text style={styles.chainName}>{ACTIVE_CHAIN.name}</Text>
          </View>
          {ACTIVE_CHAIN.steps.map((step, i) => (
            <View key={i} style={styles.stepRow}>
              <View style={styles.treeLine}>
                <Ionicons
                  name={getStepIcon(step.status)}
                  size={18}
                  color={getStepColor(step.status)}
                />
                {i < ACTIVE_CHAIN.steps.length - 1 && (
                  <View
                    style={[
                      styles.connector,
                      { backgroundColor: getStepColor(step.status) + '30' },
                    ]}
                  />
                )}
              </View>
              <View style={styles.stepInfo}>
                <Text
                  style={[
                    styles.stepAgent,
                    step.status === 'pending' && { color: C.textFaint },
                  ]}
                >
                  {step.agent}
                </Text>
                <Text
                  style={[
                    styles.stepLabel,
                    step.status === 'running' && { color: C.accent },
                    step.status === 'pending' && { color: C.textFaint },
                  ]}
                >
                  {step.label}
                </Text>
              </View>
            </View>
          ))}
        </View>

        {/* Agent List */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionLabel}>ALL AGENTS</Text>
          <Text style={styles.sectionCount}>{AGENTS.length}</Text>
        </View>
        {AGENTS.map((agent, i) => renderAgentCard(agent, i))}

        <View style={{ height: 100 }} />
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
  scroll: {
    padding: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: C.textTertiary,
    letterSpacing: 1,
  },
  sectionCount: {
    fontSize: 10,
    fontWeight: '600',
    color: C.textFaint,
  },
  card: {
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
  agentRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: {
    fontSize: 16,
    fontWeight: '700',
  },
  onlineDot: {
    position: 'absolute',
    bottom: 1,
    right: 1,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: C.green,
    borderWidth: 2,
    borderColor: C.surface,
  },
  agentInfo: {
    flex: 1,
    marginRight: 8,
  },
  agentName: {
    fontSize: 15,
    fontWeight: '700',
    color: C.text,
    marginBottom: 2,
  },
  agentDesc: {
    fontSize: 12,
    color: C.textMuted,
    lineHeight: 18,
    marginBottom: 6,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  tag: {
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  tagText: {
    fontSize: 9,
    fontWeight: '600',
  },
  chainHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  chainName: {
    fontSize: 14,
    fontWeight: '700',
    color: C.text,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 2,
  },
  treeLine: {
    width: 24,
    alignItems: 'center',
  },
  connector: {
    width: 2,
    height: 20,
    marginTop: 2,
  },
  stepInfo: {
    flex: 1,
    marginLeft: 10,
    paddingBottom: 12,
  },
  stepAgent: {
    fontSize: 13,
    fontWeight: '600',
    color: C.text,
    marginBottom: 1,
  },
  stepLabel: {
    fontSize: 11,
    color: C.textMuted,
  },
});
