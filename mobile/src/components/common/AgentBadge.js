import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { getAgent } from '../../constants/agents';

export default function AgentBadge({ agentId, size = 32 }) {
  const agent = getAgent(agentId);
  return (
    <View style={[styles.badge, { width: size, height: size, borderRadius: size / 2, backgroundColor: agent.color }]}>
      <Text style={[styles.initial, { fontSize: size * 0.45 }]}>{agent.initial}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignItems: 'center', justifyContent: 'center' },
  initial: { color: '#fff', fontWeight: '700' },
});
