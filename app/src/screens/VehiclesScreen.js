/**
 * FieldOps Mobile — VehiclesScreen
 * Vehicle management with OCR, status tracking, and GPS/geofence display.
 */
import React, { useState } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, Image, FlatList, Alert } from 'react-native';
import { CONFIG } from '../config.js';
import { listRecords, createRecord } from '../api.js';

export default function VehiclesScreen() {
  const [vehicles, setVehicles] = useState([]);
  const [plateNo, setPlateNo] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');

  async function loadVehicles() {
    try {
      const res = await listRecords('vehicles', {});
      setVehicles(res.items || []);
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  }

  async function addVehicle() {
    try {
      const res = await createRecord('vehicles', {
        company_id: 'default-company-id',
        plate_no: plateNo,
        plate_raw: plateNo,
        make: make,
        model: model,
        status: 'Active',
      });
      setPlateNo('');
      setMake('');
      setModel('');
      await loadVehicles();
      Alert.alert('Success', 'Vehicle added.');
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  }

  return (
    <ScrollView style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 20, fontWeight: 'bold', marginBottom: 12 }}>{CONFIG.platformName} Vehicles</Text>

      <View style={{ marginBottom: 12 }}>
        <TextInput placeholder="Plate No" value={plateNo} onChangeText={setPlateNo} style={{ width: '48%', borderWidth: 1, borderColor: '#ccc', padding: 8, borderRadius: 4 }} />
        <TextInput placeholder="Make" value={make} onChangeText={setMake} style={{ width: '24%', borderWidth: 1, borderColor: '#ccc', padding: 8, borderRadius: 4 }} />
        <TextInput placeholder="Model" value={model} onChangeText={setModel} style={{ width: '24%', borderWidth: 1, borderColor: '#ccc', padding: 8, borderRadius: 4 }} />
        <TouchableOpacity onPress={addVehicle} style={{ width: '24%', padding: 8, backgroundColor: CONFIG.themePrimary, borderRadius: 8, marginLeft: 4 }}>
          <Text style={{ color: '#fff', fontWeight: 'bold' }}>Add</Text>
        </TouchableOpacity>
      </View>

      <View style={{ marginTop: 24 }}>
        <Text style={{ fontSize: 14, color: '#666', marginBottom: 8 }}>Vehicle List</Text>
        <FlatList
          data={vehicles}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View style={{ padding: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd', borderRadius: 8, marginBottom: 8 }}>
              <Text style={{ fontSize: 16, fontWeight: 'bold' }}>{item.plate_no}</Text>
              <Text style={{ color: '#666', marginTop: 4 }}>{item.make} {item.model}</Text>
              <Text style={{ color: '#888', marginTop: 4 }}>{item.status}</Text>
            </View>
          )}
        />
      </View>
    </ScrollView>
  );
}