/**
 * FieldOps Mobile — JobCardScreen
 * Active job card with anti-cheat camera proof, watermarking, hold state, and QR scanning.
 */
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Image } from 'react-native';
import { Geolocation, Camera } from '../services/camera/cameraModal';
import { WatermarkService } from '../services/watermark';
import { HoldStateService } from '../services/holdState';
import { CONFIG, JOB_CODE_PREFIX, JOB_STATUS, HOLD_REASONS } from '../config.js';
import { listRecords, createRecord, updateRecord } from '../api.js';

const HOLD_OPTIONS = [
  { value: HOLD_REASONS.WAITING_FOR_SPARES, label: 'Waiting for Spares' },
  { value: HOLD_REASONS.WAITING_APPROVAL, label: 'Waiting for Approval' },
  { value: HOLD_REASONS.FACILITY_LIMITATION, label: 'Facility Limitation' },
];

export default function JobCardScreen() {
  const [jobCode, setJobCode] = useState('');
  const [plateNo, setPlateNo] = useState('');
  const [holdReason, setHoldReason] = useState(null);
  const [holdNotes, setHoldNotes] = useState('');
  const [activePhoto, setActivePhoto] = useState(null);
  const [checkedIn, setCheckedIn] = useState(true);
  const [activePin, setActivePin] = useState(null);

  async function scanQR() {
    setActivePin('scanning');
    try {
      const code = await Geolocation.scanQRCode();
      if (code) {
        setJobCode(code.toUpperCase());
      }
    } finally {
      setActivePin(null);
    }
  }

  async function captureStartProof() {
    const photo = await Camera.capturePhoto();
    const watermarked = await WatermarkService.burnWatermark(photo, {
      jobCode, plateNo, timestamp: new Date().toISOString(), lat: 17.5181, lon: 78.1685,
    });
    setActivePhoto(watermarked);
  }

  async function captureEndProof() {
    const photo = await Camera.capturePhoto();
    const watermarked = await WatermarkService.burnWatermark(photo, {
      jobCode, plateNo, timestamp: new Date().toISOString(), lat: 17.5181, lon: 78.1685,
    });
    setActivePhoto(watermarked);
  }

  function toggleOnHold() {
    if (!holdReason) return;
    HoldStateService.applyHold(jobCode, holdReason, holdNotes).then(() => {
      setHoldReason(null);
      setHoldNotes('');
      setCheckedIn(true);
    }).catch((err) => alert(err.message));
  }

  async function clearProof() {
    setActivePhoto(null);
  }

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
      <Text style={{ fontSize: 22, fontWeight: 'bold', marginBottom: 12 }}>Job Card Detail</Text>

      <TouchableOpacity onPress={scanQR} disabled={Boolean(activePin)}>
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#eee', padding: 12, borderRadius: 8 }}>
          <Text>📷 Scan Vehicle QR Code</Text>
        </View>
      </TouchableOpacity>

      <View style={{ gap: 8, marginTop: 8 }}>
        <TextInput placeholder="Vehicle Plate No" value={plateNo} onChangeText={setPlateNo} style={{ borderWidth: 1, borderColor: '#ccc', padding: 10, borderRadius: 8 }} />
        <Button title="Capture Start Proof" onPress={captureStartProof} disabled={checkedIn && !activePhoto}>
          Start Photo
        </Button>
        <Button title="Capture End Proof" onPress={captureEndProof} disabled={!checkedIn}>
          End Photo
        </Button>
        <TouchableOpacity onPress={clearProof}>
          <Text>Clear Photo</Text>
        </TouchableOpacity>
      </View>

      <View style={{ gap: 8, marginTop: 8 }}>
        <Text>Hold Reason:</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {HOLD_OPTIONS.map((o) => (
            <TouchableOpacity key={o.value} style={{ padding: 8, backgroundColor: holdReason === o.value ? CONFIG.themePrimary : '#eee', borderRadius: 8, marginRight: 4 }}
              onPress={() => setHoldReason(o.value)}>
              <Text>{o.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <View style={{ marginTop: 8 }}>
        <TextInput placeholder="Hold Notes" value={holdNotes} onChangeText={setHoldNotes} style={{ borderWidth: 1, borderColor: '#ccc', padding: 10, borderRadius: 8 }} />
        <TouchableOpacity onPress={toggleOnHold} disabled={!holdReason}>
          <Text>🔒 Put On Hold / Resume ({checkedIn ? 'Resume' : 'Put On Hold'})</Text>
        </TouchableOpacity>
      </View>

      {activePhoto && <Image source={{ uri: activePhoto }} style={{ width: '100%', height: 300, marginTop: 12, borderRadius: 8 }} />}
    </ScrollView>
  );
}

function Button({ title, onPress, disabled }) {
  return (
    <TouchableOpacity style={{ padding: 10, backgroundColor: disabled ? '#e0e0e0' : CONFIG.themePrimary, borderRadius: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
      onPress={onPress} disabled={disabled}>
      <Text style={{ color: '#fff', fontWeight: 'bold' }}>{title}</Text>
    </TouchableOpacity>
  );
}
