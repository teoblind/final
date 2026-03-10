import React from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '../context/AuthContext';
import LoginScreen from '../screens/auth/LoginScreen';
import CommandScreen from '../screens/tabs/CommandScreen';
import EstimatingScreen from '../screens/tabs/EstimatingScreen';
import AgentsScreen from '../screens/tabs/AgentsScreen';
import FilesScreen from '../screens/tabs/FilesScreen';
import SettingsScreen from '../screens/tabs/SettingsScreen';
import ChatScreen from '../screens/chat/ChatScreen';
import JobDetailScreen from '../screens/JobDetailScreen';
import ApprovalsScreen from '../screens/ApprovalsScreen';
import NotificationsScreen from '../screens/NotificationsScreen';

import { colors, fontSize } from '../constants/theme';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

const tabIconMap = {
  Command: 'grid',
  Estimating: 'clipboard',
  Agents: 'chatbubbles',
  Files: 'document-text',
  Settings: 'settings',
};

function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarIcon: ({ focused, color }) => {
          const iconName = tabIconMap[route.name] || 'ellipse';
          return <Ionicons name={focused ? iconName : `${iconName}-outline`} size={22} color={color} />;
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: 85,
          paddingBottom: 28,
          paddingTop: 8,
        },
        tabBarLabelStyle: { fontSize: fontSize.xs, fontWeight: '600' },
      })}
    >
      <Tab.Screen name="Command" component={CommandScreen} />
      <Tab.Screen name="Estimating" component={EstimatingScreen} />
      <Tab.Screen name="Agents" component={AgentsScreen} />
      <Tab.Screen name="Files" component={FilesScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  const { loading, isAuthenticated } = useAuth();

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '600', fontSize: fontSize.lg },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="Main" component={TabNavigator} options={{ headerShown: false }} />
      <Stack.Screen name="Chat" component={ChatScreen} options={({ route }) => ({ title: route.params?.agentName || 'Chat', headerBackTitle: 'Back' })} />
      <Stack.Screen name="JobDetail" component={JobDetailScreen} options={{ title: 'Job Details', headerBackTitle: 'Back' }} />
      <Stack.Screen name="Approvals" component={ApprovalsScreen} options={{ title: 'Approval Queue', headerBackTitle: 'Back' }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: 'Notifications', headerBackTitle: 'Back' }} />
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bg,
  },
});
