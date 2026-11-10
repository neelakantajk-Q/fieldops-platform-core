/**
 * FieldOps Mobile — AdminScreen
 * Administration panel with user management, settings, and platform config.
 */
import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, Button } from 'react-native';

export default function AdminScreen() {
  return (
    <ScrollView style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 20, fontWeight: 'bold', marginBottom: 12 }}>{CONFIG.platformName} Administration</Text>

      <View style={{ marginBottom: 8 }}>
        <TouchableOpacity onPress={() => alert('Edit Settings')} style={{ backgroundColor: CONFIG.themePrimary, padding: 10, borderRadius: 8 }}>
          <Text>Settings & Configuration</Text>
        </TouchableOpacity>
      </View>

      <View style={{ marginBottom: 8 }}>
        <Text style={{ fontSize: 14, color: '#666' }}>User Management</Text>
        <FlatList
          data={[]}
          keyExtractor={(item) => item.id || ''}
          renderItem={({ item }) => (
            <TouchableOpacity style={{ padding: 8, backgroundColor: '#eee', borderRadius: 8 }}>
              <Text>{item.username}</Text>
            </TouchableOpacity>
          )}
        />
      </View>

      <View style={{ marginBottom: 8 }}>
        <Text style={{ fontSize: 14, color: '#666' }}>Job Cards</Text>
        <FlatList
          data={mockJobs}
          keyExtractor={(item) => item.jobCode}
          renderItem={({ item }) => (
            <TouchableOpacity style={{ padding: 8, backgroundColor: '#eee', borderRadius: 8 }}>
              <Text>{item.description}</Text>
            </TouchableOpacity>
          )}
        />
      </View>

      <View style={{ marginBottom: 8 }}>
        <Text style={{ fontSize: 14, color: '#666' }}>Vehicle Records</Text>
        <FlatList
          data={mockVehicles}
          keyExtractor={(item) => item.plateNo}
          renderItem={({ item }) => (
            <TouchableOpacity style={{ padding: 8, backgroundColor: '#eee', borderRadius: 8 }}>
              <Text>{item.make} {item.model}</Text>
            </TouchableOpacity>
          )}
        />
      </View>
    </ScrollView>
  );
}
