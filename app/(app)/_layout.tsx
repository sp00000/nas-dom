import { Ionicons } from '@expo/vector-icons'
import { Stack, router } from 'expo-router'
import { TouchableOpacity } from 'react-native'

const ProfileButton = () => (
  <TouchableOpacity 
    onPress={() => router.push('/(app)/profile')}
    style={{ marginRight: 16 }}
  >
    <Ionicons name="person-circle-outline" size={28} color="#4A90E2" />
  </TouchableOpacity>
)

export default function AppLayout() {
  return (
    <Stack>
      <Stack.Screen 
        name="groups" 
        options={{ 
          title: 'Moje skupine',
          headerRight: () => <ProfileButton />
        }} 
      />
      <Stack.Screen 
        name="group/[groupId]" 
        options={{ 
          title: 'Skupina',
          headerRight: () => <ProfileButton />
        }} 
      />
      <Stack.Screen 
        name="tasks/index" 
        options={{ 
          title: 'Moja opravila',
          headerRight: () => <ProfileButton />
        }} 
      />
      <Stack.Screen 
        name="profile" 
        options={{ 
          title: 'Profil',
          headerRight: undefined
        }} 
      />
    </Stack>
  )
}
