/**
 * FieldOps Mobile — HomeScreen
 * Dashboard with overview of active jobs, vehicles, and team.
 */
import React, { useState } from 'react';
import { View, Text, ScrollView, FlatList, TouchableOpacity, Image } from 'react-native';
import { HomeStack } from '../App.js';
import { CONFIG } from '../config.js';

export default function HomeScreen() {
  const [activeJobs, setActiveJobs] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [reports, setReports] = useState([]);

  // Mock data — replace with real API calls
  const mockJobs = [
    { id: 'JC-20260101-HUB-001', status: CONFIG.JOB_STATUS.OPEN, vehicleId: 'V-001', description: 'Vehicle maintenance' },
    { id: 'JC-20260102-HUB-002', status: CONFIG.JOB_STATUS.IN_PROGRESS, vehicleId: 'V-002', description: 'Repair job' },
  ];
  const mockVehicles = [
    { id: 'V-001', plate: 'XYZ-1234', make: 'Toyota', model: 'Camry' },
    { id: 'V-002', plate: 'ABC-5678', make: 'Honda', model: 'Civic' },
  ];

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 24, fontWeight: 'bold', marginBottom: 8 }}>{CONFIG.platformName} Dashboard</Text>

      <ScrollView>
        <View style={{ marginBottom: 20 }}>
          <Text style={{ fontSize: 18, color: '#666' }}>Active Jobs</Text>
          <FlatList
            data={mockJobs}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity style={{ padding: 12, backgroundColor: CONFIG.themePrimary, borderRadius: 8 }}>
                <Text style={{ fontSize: 16, fontWeight: 'bold' }}>{item.id}</Text>
                <Text style={{ color: '#666', marginTop: 4 }}>{item.description}</Text>
              </TouchableOpacity>
            )}
          />
        </View>

        <View style={{ marginBottom: 20 }}>
          <Text style={{ fontSize: 18, color: '#666' }}>Vehicles</Text>
          <FlatList
            data={mockVehicles}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity style={{ padding: 12, backgroundColor: CONFIG.themePrimary, borderRadius: 8 }}>
                <Text style={{ fontSize: 16, fontWeight: 'bold' }}>{item.plate}</Text>
                <Text style={{ color: '#666', marginTop: 4 }}>{item.make} {item.model}</Text>
              </TouchableOpacity>
            )}
          />
        </View>

        <View style={{ marginTop: 20 }}>
          <Text style={{ fontSize: 18, color: '#666' }}>Reports</Text>
          <FlatList
            data={reports}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity style={{ padding: 12, backgroundColor: CONFIG.themePrimary, borderRadius: 8 }}>
                <Text style={{ fontSize: 16, fontWeight: 'bold' }}>{item.title}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      </ScrollView>
    </View>
  );
}
