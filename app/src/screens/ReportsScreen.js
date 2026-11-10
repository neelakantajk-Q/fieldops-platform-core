/**
 * FieldOps Mobile — ReportsScreen
 * Dashboard reports, uptime, analytics, and MIS exports.
 */
import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, FlatList, Alert } from 'react-native';
import { CONFIG } from '../config.js';
import { listRecords } from '../api.js';

export default function ReportsScreen() {
  const [analytics, setAnalytics] = useState({});
  const [vehicleUptime, setVehicleUptime] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);

  async function loadAnalytics() {
    try {
      const res = await listRecords('job_cards', { perPage: 200 });
      const items = res.items || [];
      const counts = { total: items.length, open: 0, closed: 0, holds: 0 };
      items.forEach((t) => {
        if (t.status === 'OPEN' || t.status === 'IN_PROGRESS') counts.open++;
        if (t.status === 'CLOSED') counts.closed++;
        if (t.status === 'ON_HOLD') counts.holds++;
      });
      setAnalytics(counts);
    } catch (e) { Alert.alert('Error', e.message); }
  }

  async function loadVehicleUptime() {
    try {
      const res = await listRecords('job_cards', { filter: 'vehicle_id != ""', expand: 'vehicle_id' });
      const byVeh = {};
      for (const t of (res.items || [])) {
        const key = (t.expand && t.expand.vehicle_id && t.expand.vehicle_id.plate_no) || t.vehicle_id;
        const down = Number(t.total_downtime_minutes) || 0;
        const row = byVeh[key] || (byVeh[key] = { plateNo: key, downtime: 0, jobs: 0 });
        row.downtime += down; row.jobs += 1;
      }
      setVehicleUptime(Object.values(byVeh));
    } catch (e) { Alert.alert('Error', e.message); }
  }

  async function loadAuditLogs() {
    try {
      const res = await listRecords('audit_logs', { sort: '-created', perPage: 50 });
      setAuditLogs(res.items || []);
    } catch (e) { Alert.alert('Error', e.message); }
  }

  useEffect(() => {
    loadAnalytics();
    loadVehicleUptime();
    loadAuditLogs();
  }, []);

  return (
    <ScrollView style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 20, fontWeight: 'bold', marginBottom: 12 }}>{CONFIG.platformName} Reports</Text>

      <View style={{ marginBottom: 12 }}>
        <Text style={{ fontSize: 16, fontWeight: 'bold', marginBottom: 8 }}>Analytics Summary</Text>
        <Text>Total Jobs: {analytics.total || 0}</Text>
        <Text>Open: {analytics.open || 0}</Text>
        <Text>Closed: {analytics.closed || 0}</Text>
        <Text>On Hold: {analytics.holds || 0}</Text>
      </View>

      <View style={{ marginBottom: 12 }}>
        <Text style={{ fontSize: 16, fontWeight: 'bold', marginBottom: 8 }}>Vehicle Uptime</Text>
        <FlatList
          data={vehicleUptime}
          keyExtractor={(item) => item.plateNo}
          renderItem={({ item }) => (
            <View style={{ padding: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd', borderRadius: 8, marginBottom: 4 }}>
              <Text style={{ fontWeight: 'bold' }}>{item.plateNo}</Text>
              <Text>Downtime: {item.downtime} min</Text>
              <Text>Jobs: {item.jobs}</Text>
            </View>
          )}
        />
      </View>

      <View>
        <Text style={{ fontSize: 16, fontWeight: 'bold', marginBottom: 8 }}>Recent Audit Logs</Text>
        <FlatList
          data={auditLogs}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View style={{ padding: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd', borderRadius: 8, marginBottom: 4 }}>
              <Text>{item.timestamp || item.created}</Text>
              <Text>{item.activity_type || ''}</Text>
              <Text>{item.details || ''}</Text>
            </View>
          )}
        />
      </View>
    </ScrollView>
  );
}