import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { useState } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { supabase } from '../../../src/lib/supabase'

export default function Register() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  const [loading, setLoading] = useState(false)

  const handleRegister = async () => {
    if (password !== confirmPassword) {
      alert('Gesli se ne ujemata')
      return
    }
    if (!email.trim() || !password || !name.trim()) {
      alert('Prosimo izpolnite vsa polja')
      return
    }
    try {
      setLoading(true)
      
      console.log('1. Začenjam registracijo na:', email.trim())
      
      // Registracija v Auth
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            display_name: name.trim(),
          }
        }
      })
      
      if (error) {
        console.error('Auth error:', error)
        alert('Napaka pri Auth registraciji: ' + error.message)
        return
      }
      
      const user = data.user
      console.log('2. Auth user ustvarjen', user?.id)
      
      if (!user) {
        alert('Napaka: uporabnik ni ustvarjen')
        return
      }
      
      // Počakaj malo, da se sproži trigger na bazi
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // Preveri, ali je profil že ustvarjen (prek triggerja)
      const { data: existingProfiles, error: checkError } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', user.id)
      
      console.log('3. Preverjam obstoječe profile', existingProfiles, checkError?.message)
      
      // Če profil ne obstaja, ga ustvari ročno
      if (!existingProfiles || existingProfiles.length === 0) {
        console.log('4. Profil ne obstaja, kreiram ga ročno...')
        const { error: insertError } = await supabase
          .from('profiles')
          .insert({
            id: user.id,
            email: email.trim(),
            display_name: name.trim()
          })
        
        if (insertError) {
          console.error('Profile insert error:', insertError)
          alert('Napaka pri ustvarjanju profila: ' + insertError.message)
          return
        }
        console.log('5. Profil uspešno ustvarjen')
      } else {
        console.log('5. Profil že obstaja (ustvaril ga je trigger)')
      }
      
      // Avtomatska prijava
      console.log('6. Prijavljam se...')
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password
      })
      
      if (signInError) {
        console.error('Sign-in error:', signInError)
          //Če je problem pri potrditvi e-pošte, obvesti uporabnika.        
        if (signInError.message.includes('not confirmed') || signInError.message.includes('Email not confirmed')) {
          alert('Registracija uspešna! Račun je ustvarjen. Lahko se prijavite.')
          router.replace('/(tabs)/(auth)/login')
          return
        }
        alert('Prijava neuspešna: ' + signInError.message)
        router.replace('/(tabs)/(auth)/login')
        return
      }
      
      console.log('7. Uspešna prijava - preusmerjanje...')
      router.replace('/groups')
    } catch (error) {
      console.error('Registration exception:', error)
      alert('Napaka: ' + String(error))
    } finally {
      setLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView 
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.content}>
          {/* Header */}
          <View style={styles.header}>
            <Ionicons name="home" size={60} color="#4A90E2" />
            <Text style={styles.title}>Naš Dom</Text>
            <Text style={styles.subtitle}>Ustvarite nov račun</Text>
          </View>

          {/* Form */}
          <View style={styles.form}>
            <View style={styles.inputContainer}>
              <Ionicons name="person-outline" size={20} color="#666" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Ime in priimek"
                placeholderTextColor="#999"
                value={name}
                onChangeText={setName}
                autoCapitalize="words"
                autoComplete="name"
              />
            </View>

            <View style={styles.inputContainer}>
              <Ionicons name="mail-outline" size={20} color="#666" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="E-pošta"
                placeholderTextColor="#999"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
              />
            </View>

            <View style={styles.inputContainer}>
              <Ionicons name="lock-closed-outline" size={20} color="#666" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Geslo"
                placeholderTextColor="#999"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
              />
              <TouchableOpacity 
                onPress={() => setShowPassword(!showPassword)}
                style={styles.eyeIcon}
              >
                <Ionicons 
                  name={showPassword ? "eye-outline" : "eye-off-outline"} 
                  size={20} 
                  color="#666" 
                />
              </TouchableOpacity>
            </View>

            <View style={styles.inputContainer}>
              <Ionicons name="lock-closed-outline" size={20} color="#666" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Potrdi geslo"
                placeholderTextColor="#999"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry={!showConfirmPassword}
                autoCapitalize="none"
              />
              <TouchableOpacity 
                onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                style={styles.eyeIcon}
              >
                <Ionicons 
                  name={showConfirmPassword ? "eye-outline" : "eye-off-outline"} 
                  size={20} 
                  color="#666" 
                />
              </TouchableOpacity>
            </View>

            <TouchableOpacity 
              style={[styles.registerButton, loading && { opacity: 0.7 }]}
              onPress={handleRegister}
              activeOpacity={0.8}
              disabled={loading}
            >
              <Text style={styles.registerButtonText}>{loading ? 'Registracija…' : 'Registriraj se'}</Text>
            </TouchableOpacity>

            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>ali</Text>
              <View style={styles.dividerLine} />
            </View>

            <TouchableOpacity 
              style={styles.loginButton}
              onPress={() => router.back()}
              activeOpacity={0.8}
            >
              <Text style={styles.loginButtonText}>Že imate račun? Prijavite se</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginTop: 16,
  },
  subtitle: {
    fontSize: 16,
    color: '#7f8c8d',
    marginTop: 8,
  },
  form: {
    width: '100%',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e1e8ed',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    height: 50,
    fontSize: 16,
    color: '#2c3e50',
  },
  eyeIcon: {
    padding: 8,
  },
  registerButton: {
    backgroundColor: '#4A90E2',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
    shadowColor: '#4A90E2',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  registerButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 24,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#e1e8ed',
  },
  dividerText: {
    marginHorizontal: 16,
    color: '#7f8c8d',
    fontSize: 14,
  },
  loginButton: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#4A90E2',
  },
  loginButtonText: {
    color: '#4A90E2',
    fontSize: 16,
    fontWeight: '600',
  },
})
