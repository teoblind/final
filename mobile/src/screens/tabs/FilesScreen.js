import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../../services/api';

const C = {
  bg: '#fafaf8',
  surface: '#ffffff',
  surfaceInset: '#f5f4f0',
  border: '#e8e6e1',
  borderLight: '#f0eeea',
  accent: '#1e3a5f',
  accentBg: '#eef3f9',
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

const TYPE_BADGE = {
  doc: { letter: 'D', bg: C.accent + '18', color: C.accent },
  sheet: { letter: 'S', bg: C.greenBg, color: C.green },
  slides: { letter: 'P', bg: C.warmBg, color: C.warm },
  pdf: { letter: 'F', bg: C.dangerBg, color: C.danger },
};

const DEMO_FILES = {
  Estimates: [
    { name: 'Bishop Arts Mixed-Use Estimate', type: 'sheet', modified: '2h ago', owner: 'Estimating Bot' },
    { name: 'I-35 Retaining Walls Takeoff', type: 'sheet', modified: '1d ago', owner: 'Estimating Bot' },
    { name: 'Q1 2026 Pricing Reference', type: 'sheet', modified: '3d ago', owner: 'David C.' },
  ],
  Bids: [
    { name: 'Hensel Phelps - Bishop Arts Bid', type: 'doc', modified: '3h ago', owner: 'Email Agent' },
    { name: 'Austin Bridge - I-35 Proposal', type: 'doc', modified: '2d ago', owner: 'Email Agent' },
  ],
  'Field Reports': [
    { name: 'FR-2026-0307 - Cedar Hill', type: 'doc', modified: '4h ago', owner: 'Field Team' },
    { name: 'FR-2026-0306 - Legacy West', type: 'doc', modified: '1d ago', owner: 'Field Team' },
  ],
  Jobs: [
    { name: 'Cedar Hill Townhomes - Cost Tracker', type: 'sheet', modified: '1h ago', owner: 'DACP Agent' },
    { name: 'Baylor Clinic - Change Order Log', type: 'sheet', modified: '5h ago', owner: 'DACP Agent' },
  ],
};

const FOLDER_ICONS = {
  Estimates: 'calculator-outline',
  Bids: 'document-text-outline',
  'Field Reports': 'clipboard-outline',
  Jobs: 'construct-outline',
};

export default function FilesScreen() {
  const insets = useSafeAreaInsets();
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedFolders, setExpandedFolders] = useState({ Estimates: true });
  const [refreshing, setRefreshing] = useState(false);

  const toggleFolder = (folderName) => {
    setExpandedFolders((prev) => ({
      ...prev,
      [folderName]: !prev[folderName],
    }));
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await api.getWorkspaceFiles();
    } catch {
      // silently fail, keep demo data
    }
    setRefreshing(false);
  }, []);

  const getFilteredFiles = (files) => {
    if (!searchQuery.trim()) return files;
    const q = searchQuery.toLowerCase();
    return files.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        f.owner.toLowerCase().includes(q)
    );
  };

  const getVisibleFolders = () => {
    if (!searchQuery.trim()) return Object.keys(DEMO_FILES);
    return Object.keys(DEMO_FILES).filter(
      (folder) => getFilteredFiles(DEMO_FILES[folder]).length > 0
    );
  };

  const renderFileItem = (file, index) => {
    const badge = TYPE_BADGE[file.type] || TYPE_BADGE.doc;
    return (
      <TouchableOpacity key={index} style={styles.fileRow} activeOpacity={0.6}>
        <View style={[styles.typeBadge, { backgroundColor: badge.bg }]}>
          <Text style={[styles.typeBadgeText, { color: badge.color }]}>{badge.letter}</Text>
        </View>
        <View style={styles.fileInfo}>
          <Text style={styles.fileName} numberOfLines={1}>{file.name}</Text>
          <Text style={styles.fileMeta}>{file.modified} · {file.owner}</Text>
        </View>
        <Ionicons name="ellipsis-horizontal" size={16} color={C.textFaint} />
      </TouchableOpacity>
    );
  };

  const renderFolder = (folderName) => {
    const icon = FOLDER_ICONS[folderName] || 'folder-outline';
    const files = getFilteredFiles(DEMO_FILES[folderName]);
    const isExpanded = expandedFolders[folderName] || searchQuery.trim().length > 0;

    return (
      <View key={folderName} style={styles.folderBlock}>
        <TouchableOpacity
          style={styles.folderRow}
          onPress={() => toggleFolder(folderName)}
          activeOpacity={0.7}
        >
          <Ionicons
            name={isExpanded ? 'chevron-down' : 'chevron-forward'}
            size={16}
            color={C.textMuted}
          />
          <Ionicons
            name={isExpanded ? 'folder-open' : 'folder'}
            size={18}
            color={C.warm}
            style={{ marginLeft: 6 }}
          />
          <Text style={styles.folderName}>{folderName}</Text>
          <View style={styles.folderCountBadge}>
            <Text style={styles.folderCount}>{files.length}</Text>
          </View>
        </TouchableOpacity>

        {isExpanded && files.length > 0 && (
          <View style={styles.fileList}>
            {files.map(renderFileItem)}
          </View>
        )}
        {isExpanded && files.length === 0 && (
          <Text style={styles.noResults}>No matching files</Text>
        )}
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Files</Text>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={16} color={C.textFaint} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search files..."
            placeholderTextColor={C.textFaint}
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={16} color={C.textFaint} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Folder List */}
      <ScrollView
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={C.accent}
          />
        }
      >
        {getVisibleFolders().map(renderFolder)}

        {getVisibleFolders().length === 0 && (
          <View style={styles.emptyState}>
            <Ionicons name="folder-open-outline" size={40} color={C.textFaint} />
            <Text style={styles.emptyText}>No files found</Text>
          </View>
        )}

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
  searchWrap: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surfaceInset,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 40,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: C.text,
    height: 40,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  folderBlock: {
    marginBottom: 4,
  },
  folderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    gap: 4,
  },
  folderName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: C.text,
    marginLeft: 6,
  },
  folderCountBadge: {
    backgroundColor: C.surfaceInset,
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  folderCount: {
    fontSize: 11,
    fontWeight: '500',
    color: C.textFaint,
  },
  fileList: {
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 8,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.borderLight,
  },
  typeBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  typeBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  fileInfo: {
    flex: 1,
    marginRight: 8,
  },
  fileName: {
    fontSize: 13,
    fontWeight: '600',
    color: C.text,
    marginBottom: 2,
  },
  fileMeta: {
    fontSize: 11,
    color: C.textMuted,
  },
  noResults: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 13,
    color: C.textMuted,
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    color: C.textMuted,
  },
});
