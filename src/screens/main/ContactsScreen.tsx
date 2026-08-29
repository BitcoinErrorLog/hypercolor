import React from 'react';
import { View, Text, StyleSheet, SafeAreaView } from 'react-native';
import { useContactStore } from '../../stores/contactStore';

export default function ContactsScreen() {
  const contacts = useContactStore(s => Object.values(s.contacts));

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Contacts</Text>
      </View>
      {contacts.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No contacts yet.</Text>
          <Text style={styles.emptyHint}>Search by Pubky key to add someone.</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1a1a1a',
  },
  title: { fontSize: 24, fontWeight: '700', color: '#f9fafb' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 },
  emptyText: { color: '#6b7280', fontSize: 16 },
  emptyHint: { color: '#4b5563', fontSize: 14 },
});
