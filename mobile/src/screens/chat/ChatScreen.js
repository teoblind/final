import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Animated,
  Linking,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getAgent } from '../../constants/agents';
import * as api from '../../services/api';
import { colors, spacing, radius, fontSize } from '../../constants/theme';

const TypingIndicator = ({ color }) => {
  const dot1 = useRef(new Animated.Value(0.3)).current;
  const dot2 = useRef(new Animated.Value(0.3)).current;
  const dot3 = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const animate = (dot, delay) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, { toValue: 1, duration: 400, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0.3, duration: 400, useNativeDriver: true }),
        ])
      );
    const a1 = animate(dot1, 0);
    const a2 = animate(dot2, 200);
    const a3 = animate(dot3, 400);
    a1.start();
    a2.start();
    a3.start();
    return () => { a1.stop(); a2.stop(); a3.stop(); };
  }, []);

  return (
    <View style={styles.typingContainer}>
      <View style={[styles.typingBubble, { backgroundColor: colors.surfaceInset }]}>
        {[dot1, dot2, dot3].map((dot, i) => (
          <Animated.View
            key={i}
            style={[
              styles.typingDot,
              { backgroundColor: color || colors.accent, opacity: dot },
            ]}
          />
        ))}
      </View>
    </View>
  );
};

const WorkspaceCard = ({ action }) => {
  if (!action) return null;

  const renderCreated = () => (
    <View style={styles.workspaceCard}>
      <View style={styles.workspaceHeader}>
        <Ionicons
          name={
            action.fileType === 'spreadsheet'
              ? 'grid-outline'
              : action.fileType === 'presentation'
              ? 'easel-outline'
              : 'document-text-outline'
          }
          size={20}
          color={colors.accent}
        />
        <Text style={styles.workspaceTitle} numberOfLines={1}>
          {action.title || 'Untitled'}
        </Text>
      </View>
      <TouchableOpacity
        style={styles.openButton}
        onPress={() => action.url && Linking.openURL(action.url)}
      >
        <Text style={styles.openButtonText}>Open in Google</Text>
        <Ionicons name="open-outline" size={14} color={colors.accent} />
      </TouchableOpacity>
    </View>
  );

  const renderSearch = () => (
    <View style={styles.workspaceCard}>
      <Text style={styles.workspaceLabel}>Files found</Text>
      {(action.files || []).map((file, i) => (
        <TouchableOpacity
          key={i}
          style={styles.searchFileRow}
          onPress={() => file.url && Linking.openURL(file.url)}
        >
          <Ionicons name="document-outline" size={16} color={colors.textMuted} />
          <Text style={styles.searchFileName} numberOfLines={1}>
            {file.name || file.title}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  const ReadCard = () => {
    const [expanded, setExpanded] = useState(false);
    return (
      <View style={styles.workspaceCard}>
        <TouchableOpacity
          style={styles.workspaceHeader}
          onPress={() => setExpanded(!expanded)}
        >
          <Ionicons name="eye-outline" size={20} color={colors.accent} />
          <Text style={styles.workspaceTitle} numberOfLines={1}>
            {action.title || 'Document Preview'}
          </Text>
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.textMuted}
          />
        </TouchableOpacity>
        {expanded && (
          <Text style={styles.previewText} numberOfLines={12}>
            {action.content || action.preview || ''}
          </Text>
        )}
      </View>
    );
  };

  if (action.type === 'created' || action.type === 'create') return renderCreated();
  if (action.type === 'search') return renderSearch();
  if (action.type === 'read') return <ReadCard />;
  return null;
};

const MessageBubble = ({ message, agentColor }) => {
  const isUser = message.role === 'user';
  const timestamp = message.timestamp
    ? new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <View style={[styles.messageRow, isUser ? styles.messageRowRight : styles.messageRowLeft]}>
      <View
        style={[
          styles.bubble,
          isUser ? styles.userBubble : styles.assistantBubble,
          !isUser && agentColor ? { borderLeftColor: agentColor, borderLeftWidth: 3 } : null,
        ]}
      >
        <Text style={[styles.bubbleText, isUser ? styles.userBubbleText : styles.assistantBubbleText]}>
          {message.content || message.text || ''}
        </Text>
        {message.workspace && <WorkspaceCard action={message.workspace} />}
      </View>
      {timestamp ? (
        <Text style={[styles.timestamp, isUser ? styles.timestampRight : styles.timestampLeft]}>
          {timestamp}
        </Text>
      ) : null}
    </View>
  );
};

export default function ChatScreen({ route, navigation }) {
  const { agentId, agentName, agentColor, initialMessage } = route.params || {};
  const agent = getAgent ? getAgent(agentId) : null;
  const displayName = agentName || (agent && agent.name) || 'Agent';
  const displayColor = agentColor || (agent && agent.color) || colors.accent;

  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const flatListRef = useRef(null);
  const initialMessageSent = useRef(false);

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={() =>
            Alert.alert('Clear Chat', 'Clear all messages?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Clear', style: 'destructive', onPress: () => setMessages([]) },
            ])
          }
          style={{ marginRight: spacing.md }}
        >
          <Ionicons name="trash-outline" size={20} color={colors.textMuted} />
        </TouchableOpacity>
      ),
    });
  }, [navigation]);

  useEffect(() => {
    loadMessages();
  }, [agentId]);

  const loadMessages = async () => {
    setLoading(true);
    try {
      const response = await api.getMessages(agentId);
      if (response && response.messages) {
        setMessages(response.messages);
      }
    } catch (err) {
      console.log('Failed to load messages:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!loading && initialMessage && !initialMessageSent.current && messages.length === 0) {
      initialMessageSent.current = true;
      handleSend(initialMessage);
    }
  }, [loading]);

  const handleSend = async (text) => {
    const content = text || inputText.trim();
    if (!content || sending) return;

    const userMessage = {
      id: Date.now().toString(),
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputText('');
    setSending(true);
    setIsTyping(true);

    try {
      const response = await api.sendMessage(agentId, content);
      if (response && response.message) {
        setMessages((prev) => [...prev, response.message]);
      }
    } catch (err) {
      console.log('Failed to send message:', err);
    } finally {
      setSending(false);
      setIsTyping(false);
    }
  };

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 100);
  }, []);

  useEffect(() => {
    if (messages.length > 0) scrollToBottom();
  }, [messages, isTyping]);

  const renderEmpty = () => {
    if (loading) {
      return (
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      );
    }
    return (
      <View style={styles.emptyContainer}>
        <View style={[styles.emptyIcon, { backgroundColor: displayColor + '18' }]}>
          <Ionicons name="chatbubbles-outline" size={40} color={displayColor} />
        </View>
        <Text style={styles.emptyTitle}>Start a conversation with {displayName}</Text>
        <Text style={styles.emptySubtitle}>Send a message to get started</Text>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id || Math.random().toString()}
        renderItem={({ item }) => <MessageBubble message={item} agentColor={displayColor} />}
        contentContainerStyle={[
          styles.messagesList,
          messages.length === 0 && styles.messagesListEmpty,
        ]}
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={isTyping ? <TypingIndicator color={displayColor} /> : null}
        onContentSizeChange={scrollToBottom}
      />

      <View style={styles.inputArea}>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.textInput}
            placeholder="Type a message..."
            placeholderTextColor={colors.textTertiary}
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={2000}
            returnKeyType="default"
          />
          <TouchableOpacity
            style={[
              styles.sendButton,
              inputText.trim() ? styles.sendButtonActive : styles.sendButtonInactive,
            ]}
            onPress={() => handleSend()}
            disabled={!inputText.trim() || sending}
          >
            <Ionicons
              name="arrow-up"
              size={20}
              color={inputText.trim() ? '#ffffff' : colors.textTertiary}
            />
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  messagesList: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  messagesListEmpty: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  messageRow: {
    marginBottom: spacing.sm,
    maxWidth: '82%',
  },
  messageRowRight: {
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
  },
  messageRowLeft: {
    alignSelf: 'flex-start',
    alignItems: 'flex-start',
  },
  bubble: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 18,
  },
  userBubble: {
    backgroundColor: colors.accent,
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    backgroundColor: colors.surfaceInset,
    borderBottomLeftRadius: 4,
  },
  bubbleText: {
    fontSize: fontSize.md,
    lineHeight: 22,
  },
  userBubbleText: {
    color: '#ffffff',
  },
  assistantBubbleText: {
    color: colors.text,
  },
  timestamp: {
    fontSize: 10,
    color: colors.textFaint,
    marginTop: 3,
  },
  timestampRight: {
    marginRight: 4,
  },
  timestampLeft: {
    marginLeft: 4,
  },
  typingContainer: {
    alignSelf: 'flex-start',
    marginBottom: spacing.sm,
  },
  typingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    gap: 5,
  },
  typingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  workspaceCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 12,
    marginTop: 8,
  },
  workspaceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  workspaceTitle: {
    flex: 1,
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.text,
  },
  workspaceLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  openButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.accentBg,
  },
  openButtonText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.accent,
  },
  searchFileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  searchFileName: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.text,
  },
  previewText: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    lineHeight: 20,
    marginTop: 8,
  },
  inputArea: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    paddingBottom: Platform.OS === 'ios' ? spacing.lg : spacing.sm,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  textInput: {
    flex: 1,
    backgroundColor: colors.surfaceInset,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: fontSize.md,
    color: colors.text,
    maxHeight: 100,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonActive: {
    backgroundColor: colors.accent,
  },
  sendButtonInactive: {
    backgroundColor: colors.surfaceInset,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  emptyTitle: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
