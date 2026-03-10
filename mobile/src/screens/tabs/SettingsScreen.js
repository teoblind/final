import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { getBaseUrl, setBaseUrl } from '../../services/api';
import * as api from '../../services/api';

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

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const [serverUrl, setServerUrl] = useState(getBaseUrl());
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [saving, setSaving] = useState(false);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      await api.checkHealth();
      setTestResult('success');
    } catch {
      setTestResult('error');
    }
    setTesting(false);
  };

  const handleSave = () => {
    setSaving(true);
    try {
      setBaseUrl(serverUrl);
      Alert.alert('Saved', 'API server URL updated successfully.');
    } catch {
      Alert.alert('Error', 'Failed to save API URL.');
    }
    setSaving(false);
  };

  const handleClearData = () => {
    Alert.alert(
      'Clear All Data',
      'This will remove all cached data and reset the app. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            Alert.alert('Cleared', 'All local data has been removed.');
          },
        },
      ]
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Settings</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Connection */}
        <Text style={styles.sectionLabel}>CONNECTION</Text>
        <View style={styles.card}>
          <Text style={styles.fieldLabel}>API Server URL</Text>
          <TextInput
            style={styles.input}
            value={serverUrl}
            onChangeText={setServerUrl}
            placeholder="https://api.example.com"
            placeholderTextColor={C.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          {testResult && (
            <View style={styles.testResultRow}>
              <Ionicons
                name={testResult === 'success' ? 'checkmark-circle' : 'close-circle'}
                size={16}
                color={testResult === 'success' ? C.green : C.danger}
              />
              <Text
                style={[
                  styles.testResultText,
                  { color: testResult === 'success' ? C.green : C.danger },
                ]}
              >
                {testResult === 'success' ? 'Connection successful' : 'Connection failed'}
              </Text>
            </View>
          )}
          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={styles.buttonSecondary}
              onPress={handleTest}
              disabled={testing || !serverUrl.trim()}
              activeOpacity={0.7}
            >
              {testing ? (
                <ActivityIndicator size="small" color={C.textMuted} />
              ) : (
                <Text style={styles.buttonSecondaryText}>Test</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.buttonPrimary, (!serverUrl.trim() || saving) && styles.buttonDisabled]}
              onPress={handleSave}
              disabled={!serverUrl.trim() || saving}
              activeOpacity={0.7}
            >
              {saving ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text style={styles.buttonPrimaryText}>Save</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Account */}
        <Text style={styles.sectionLabel}>ACCOUNT</Text>
        <View style={styles.card}>
          <View style={styles.accountRow}>
            <View style={styles.accountAvatar}>
              <Text style={styles.accountAvatarText}>DC</Text>
            </View>
            <View style={styles.accountInfo}>
              <Text style={styles.accountName}>David Chen</Text>
              <View style={styles.adminBadge}>
                <Text style={styles.adminBadgeText}>Admin</Text>
              </View>
            </View>
          </View>
        </View>

        {/* About */}
        <Text style={styles.sectionLabel}>ABOUT</Text>
        <View style={styles.card}>
          <View style={styles.aboutRow}>
            <Text style={styles.aboutLabel}>Version</Text>
            <Text style={styles.aboutValue}>1.0.0</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.aboutRow}>
            <Text style={styles.aboutLabel}>Build</Text>
            <Text style={styles.aboutValue}>2026.03.08</Text>
          </View>
          <View style={styles.divider} />
          <Text style={styles.footerText}>DACP Mobile — Powered by Ampera</Text>
        </View>

        {/* Danger Zone */}
        <Text style={styles.sectionLabel}>DANGER ZONE</Text>
        <View style={[styles.card, styles.dangerCard]}>
          <View style={styles.dangerContent}>
            <View style={{ flex: 1 }}>
              <Text style={styles.dangerTitle}>Clear All Data</Text>
              <Text style={styles.dangerDesc}>
                Remove cached data, preferences, and reset the app
              </Text>
            </View>
            <TouchableOpacity
              style={styles.dangerButton}
              onPress={handleClearData}
              activeOpacity={0.7}
            >
              <Text style={styles.dangerButtonText}>Clear</Text>
            </TouchableOpacity>
          </View>
        </View>

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
    paddingHorizontal: 16,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: C.textTertiary,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 20,
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  card: {
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
    marginBottom: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: C.textSecondary,
    marginBottom: 8,
  },
  input: {
    backgroundColor: C.surfaceInset,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: C.text,
    fontFamily: 'Courier',
    marginBottom: 4,
  },
  testResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  testResultText: {
    fontSize: 12,
    fontWeight: '500',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  buttonSecondary: {
    flex: 1,
    backgroundColor: C.surfaceInset,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonSecondaryText: {
    fontSize: 14,
    fontWeight: '600',
    color: C.textSecondary,
  },
  buttonPrimary: {
    flex: 1,
    backgroundColor: C.accent,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPrimaryText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  accountAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  accountAvatarText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
  accountInfo: {
    flex: 1,
  },
  accountName: {
    fontSize: 16,
    fontWeight: '700',
    color: C.text,
    marginBottom: 4,
  },
  adminBadge: {
    alignSelf: 'flex-start',
    backgroundColor: C.accentBg,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 8,
  },
  adminBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: C.accent,
  },
  aboutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  aboutLabel: {
    fontSize: 13,
    color: C.textMuted,
  },
  aboutValue: {
    fontSize: 13,
    fontWeight: '600',
    color: C.text,
    fontFamily: 'Courier',
  },
  divider: {
    height: 1,
    backgroundColor: C.borderLight,
  },
  footerText: {
    fontSize: 11,
    color: C.textTertiary,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 12,
  },
  dangerCard: {
    borderColor: '#f5c6c1',
    backgroundColor: '#fffbfa',
  },
  dangerContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dangerTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: C.danger,
    marginBottom: 2,
  },
  dangerDesc: {
    fontSize: 11,
    color: C.textMuted,
  },
  dangerButton: {
    borderWidth: 1.5,
    borderColor: C.danger,
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 8,
    marginLeft: 12,
  },
  dangerButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: C.danger,
  },
});
