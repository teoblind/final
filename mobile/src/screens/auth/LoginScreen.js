import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';

const theme = {
  bg: '#fafaf8',
  surface: '#ffffff',
  surfaceInset: '#f5f4f0',
  border: '#e8e6e1',
  accent: '#1e3a5f',
  accentBg: '#eef3f9',
  danger: '#c0392b',
  dangerBg: '#fbeae8',
  text: '#111110',
  textMuted: '#6b6b65',
  textTertiary: '#9a9a92',
  textFaint: '#c5c5bc',
};

export default function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    if (!email.trim() || !password.trim()) {
      setError('Please enter both email and password');
      return;
    }

    setError('');
    setLoading(true);

    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inner}>
        {/* Top section */}
        <View style={styles.topSection}>
          <View style={styles.mark}>
            <Text style={styles.markText}>D</Text>
          </View>
          <Text style={styles.title}>DACP</Text>
          <Text style={styles.subtitle}>Construction Intelligence</Text>
        </View>

        {/* Form section */}
        <View style={styles.formSection}>
          <View style={styles.inputWrapper}>
            <Ionicons
              name="mail-outline"
              size={20}
              color={theme.textMuted}
              style={styles.inputIcon}
            />
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor={theme.textTertiary}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
            />
          </View>

          <View style={styles.inputWrapper}>
            <Ionicons
              name="lock-closed-outline"
              size={20}
              color={theme.textMuted}
              style={styles.inputIcon}
            />
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor={theme.textTertiary}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              textContentType="password"
            />
          </View>

          {error ? (
            <Text style={styles.errorText}>{error}</Text>
          ) : null}

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color="#ffffff" size="small" />
            ) : (
              <Text style={styles.buttonText}>Sign In</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Bottom section */}
        <View style={styles.bottomSection}>
          <Text style={styles.demoHint}>
            Demo: david@dacp.com / demo123
          </Text>
          <Text style={styles.powered}>Powered by Ampera</Text>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  inner: {
    flex: 1,
    paddingHorizontal: 32,
    justifyContent: 'center',
  },
  topSection: {
    alignItems: 'center',
    marginBottom: 48,
    paddingTop: 20,
  },
  mark: {
    width: 48,
    height: 48,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  markText: {
    fontSize: 20,
    fontWeight: '700',
    color: theme.accent,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: theme.text,
    letterSpacing: 1,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: theme.textMuted,
  },
  formSection: {
    gap: 14,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.surfaceInset,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 10,
    height: 48,
    paddingHorizontal: 14,
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: theme.text,
    height: '100%',
  },
  errorText: {
    color: theme.danger,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 2,
  },
  button: {
    backgroundColor: theme.accent,
    height: 50,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  bottomSection: {
    alignItems: 'center',
    marginTop: 48,
    gap: 8,
  },
  demoHint: {
    fontSize: 12,
    color: theme.textFaint,
  },
  powered: {
    fontSize: 12,
    color: theme.textFaint,
  },
});
