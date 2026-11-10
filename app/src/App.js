/**
 * FieldOps Mobile App - Entry Point
 * React Native implementation with PocketBase backend.
 * Whitelabeled: package name, app name, assets contain zero default template names.
 */
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { Text } from 'react-native';

import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import AttendanceScreen from './src/screens/AttendanceScreen';
import JobCardScreen from './src/screens/JobCardScreen';
import VehiclesScreen from './src/screens/VehiclesScreen';
import ReportsScreen from './src/screens/ReportsScreen';
import AdminScreen from './src/screens/AdminScreen';

const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

function HomeStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'FieldOps' }} />
      <Stack.Screen name="JobCard" component={JobCardScreen} options={{ title: 'Job Card' }} />
    </Stack.Navigator>
  );
}

function App() {
  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          tabBarIcon: ({ focused, color, size }) => {
            let icon = '?';
            if (route.name === 'Home') icon = '🏠';
            if (route.name === 'Attendance') icon = '📍';
            if (route.name === 'Jobs') icon = '🔧';
            if (route.name === 'Vehicles') icon = '🚗';
            if (route.name === 'Reports') icon = '📊';
            if (route.name === 'Admin') icon = '⚙️';
            return <Text style={{ fontSize: size }}>{icon}</Text>;
          },
          tabBarActiveTintColor: '#a6ce39',
          tabBarInactiveTintColor: 'gray',
        })}
      >
        <Tab.Screen name="Home" component={HomeScreen} />
        <Tab.Screen name="Attendance" component={AttendanceScreen} />
        <Tab.Screen name="Jobs" component={JobCardScreen} />
        <Tab.Screen name="Vehicles" component={VehiclesScreen} />
        <Tab.Screen name="Reports" component={ReportsScreen} />
        <Tab.Screen name="Admin" component={AdminScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

export default App;