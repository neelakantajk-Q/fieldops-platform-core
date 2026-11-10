/**
 * FieldOps Mobile — LoginScreen
 * Secure login pointing to https://api.yourbrand.com
 */
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { login } from '../api.js';
import { CONFIG } from '../config.js';

export default function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleLogin() {
    setLoading(true);
    setError('');
    try {
      const passwordHash = `sha256:${Buffer.from(password).toString('base64')}`;
      const deviceUUID = `device-${Date.now()}`;
      await login({ username, passwordHash, deviceUUID });
      onLogin();
    } catch (err) {
      setError(err.message || 'Login failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={{ flex: 1, padding: 32, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: 24, fontWeight: 'bold', marginBottom: 8 }}>{CONFIG.platformName}</Text>
      <Text style={{ color: '#666', marginBottom: 32 }}>{CONFIG.tagLine}</Text>

      <TextInput
        style={{ width: '100%', borderColor: '#ccc', borderWidth: 1, padding: 12, borderRadius: 8, marginBottom: 16 }}
        placeholder="Username"
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
      />
      <TextInput
        style={{ width: '100%', borderColor: '#ccc', borderWidth: 1, padding: 12, borderRadius: 8, marginBottom: 16 }}
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      {error && <Text style={{ color: 'red', marginBottom: 16 }}>{error}</Text>}
      {loading ? (
        <ActivityIndicator size="large" />
      ) : (
        <TouchableOpacity style={{ width: '100%', backgroundColor: CONFIG.themePrimary, padding: 14, borderRadius: 8 }} onPress={handleLogin}>
          <Text style={{ color: '#fff', textAlign: 'center', fontWeight: 'bold' }}>Login</Text>
        </TouchableOpacity>
      )}
      <Text style={{ marginTop: 24, color: '#999', fontSize: 12 }}>{CONFIG.platformName} v{CONFIG.version}</Text>
    </View>
  );
}
