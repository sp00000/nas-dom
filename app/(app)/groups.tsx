import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Alert, FlatList, Modal, RefreshControl, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { supabase } from '../../src/lib/supabase'

interface GroupMember {
  id: string
  name: string
}

interface Group {
  id: string
  name: string
  description: string
  memberCount?: number
  members?: GroupMember[]
}

export default function Groups() {
  const [groups, setGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(false)

  const [modalVisible, setModalVisible] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupDescription, setNewGroupDescription] = useState('')

  const colors = ['#4A90E2', '#50C878', '#FF6B6B', '#9B59B6', '#F39C12', '#1ABC9C']

  const loadGroups = async () => {
    setLoading(true)
    
    // Pridobi trenutnega uporabnika
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setLoading(false)
      return
    }

    // Pridobi skupine, kjer je uporabnik član
    const { data: memberData, error: memberError } = await supabase
      .from('group_members')
      .select('group_id')
      .eq('user_id', user.id)

    if (memberError) {
      console.warn('Failed to load member groups:', memberError.message)
      setLoading(false)
      return
    }

    const groupIds = (memberData ?? []).map((m: any) => m.group_id)
    
    if (groupIds.length === 0) {
      setGroups([])
      setLoading(false)
      return
    }

    // Pridobi podrobnosti skupin za te skupine
    const { data, error } = await supabase
      .from('groups')
      .select('id,name,description, group_members(count)')
      .in('id', groupIds)

    if (error) {
      console.warn('Failed to load groups:', error.message)
    } else {
      const mapped: Group[] = (data ?? []).map((g: any) => {
        const count = Array.isArray(g.group_members) && g.group_members.length > 0
          ? g.group_members[0].count ?? 0
          : 0
        return {
          id: g.id,
          name: g.name,
          description: g.description ?? '',
          memberCount: count,
        }
      })
      setGroups(mapped)
    }
    setLoading(false)
  }

  useEffect(() => {
    loadGroups()
  }, [])

  const handleLeaveGroup = async (groupId: string, groupName: string) => {
    Alert.alert(
      'Zapusti skupino',
      `Ali ste prepričani, da želite zapustiti skupino "${groupName}"?`,
      [
        { text: 'Prekliči', style: 'cancel' },
        {
          text: 'Da',
          style: 'destructive',
          onPress: async () => {
            const { data: userRes } = await supabase.auth.getUser()
            const userId = userRes?.user?.id
            if (!userId) return

            try {
              const { error } = await supabase
                .from('group_members')
                .delete()
                .eq('group_id', groupId)
                .eq('user_id', userId)
              
              if (error) {
                Alert.alert('Napaka', 'Napaka pri zapuščanju skupine')
              } else {
                setGroups(groups.filter(g => g.id !== groupId))
                Alert.alert('Uspeh', 'Uspešno ste zapustili skupino')
              }
            } catch (err) {
              Alert.alert('Napaka', 'Napaka pri zapuščanju skupine')
            }
          }
        }
      ]
    )
  }

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) {
      Alert.alert('Napaka', 'Prosim vnesite ime skupine')
      return
    }

    // Try to create on Supabase; fallback locally if it fails
    const { data: userRes } = await supabase.auth.getUser()
    const ownerId = userRes?.user?.id
    const payload = {
      name: newGroupName.trim(),
      description: newGroupDescription.trim(),
      owner_id: ownerId ?? null,
    }

    const { data, error } = await supabase.from('groups').insert(payload).select().single()
    if (error || !data) {
      const newGroup: Group = {
        id: Date.now().toString(),
        name: payload.name,
        description: payload.description,
        memberCount: 1,
      }
      setGroups([...groups, newGroup])
    } else {
      setGroups([...groups, { id: data.id, name: data.name, description: data.description ?? '', memberCount: 1 }])
      // Dodaj lastnika kot člana skupine
      if (ownerId) {
        try { 
          await supabase.from('group_members').insert({ 
            group_id: data.id, 
            user_id: ownerId,
            completed_count: 0,
            completed_stars: 0,
            overdue_count: 0
          }) 
        } catch {}
      }
    }
    setNewGroupName('')
    setNewGroupDescription('')
    setModalVisible(false)
  }

  const renderGroup = ({ item }: { item: Group }) => {
    const derivedCount = item.members?.length ?? item.memberCount ?? 0

    return (
      <TouchableOpacity
        style={[styles.groupCard, { borderLeftColor: '#4A90E2' }]}
        onPress={() => router.push(`/group/${item.id}`)}
        activeOpacity={0.7}
      >
        <TouchableOpacity
          style={styles.leaveButton}
          onPress={(e) => {
            e.stopPropagation()
            handleLeaveGroup(item.id, item.name)
          }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="close" size={20} color="#7f8c8d" />
        </TouchableOpacity>
        <View style={styles.groupHeader}>
          <View style={[styles.groupIcon, { backgroundColor: '#4A90E2' }]}>
            <Ionicons name="home" size={24} color="#fff" />
          </View>
          <View style={styles.groupInfo}>
            <Text style={styles.groupName}>{item.name}</Text>
            <Text style={styles.groupDescription}>{item.description}</Text>
          </View>
        </View>
        <View style={styles.groupFooter}>
          <View style={styles.memberCount}>
            <Ionicons name="people" size={16} color="#7f8c8d" />
            <Text style={styles.memberCountText}>{derivedCount} članov</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#7f8c8d" />
        </View>
      </TouchableOpacity>
    )
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={groups}
        renderItem={renderGroup}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={loadGroups} />}
        ListHeaderComponent={
          <TouchableOpacity
            style={styles.myTasksCard}
            onPress={() => router.push('/tasks')}
            activeOpacity={0.7}
          >
            <View style={styles.myTasksLeft}>
              <View style={styles.myTasksIcon}>
                <Ionicons name="checkbox-outline" size={28} color="#4A90E2" />
              </View>
              <View>
                <Text style={styles.myTasksTitle}>Moja opravila</Text>
                <Text style={styles.myTasksSubtitle}>Preglej vse svoje naloge</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={24} color="#4A90E2" />
          </TouchableOpacity>
        }
      />

      {/* Floating Action Button */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => setModalVisible(true)}
        activeOpacity={0.8}
      >
        <Ionicons name="add" size={32} color="#fff" />
      </TouchableOpacity>

      {/* Create Group Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Nova skupina</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <Ionicons name="close" size={28} color="#2c3e50" />
              </TouchableOpacity>
            </View>

            <View style={styles.modalForm}>
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Ime skupine</Text>
                <TextInput
                  style={styles.input}
                  placeholder="npr. Družina, Sostanovalci..."
                  placeholderTextColor="#999"
                  value={newGroupName}
                  onChangeText={setNewGroupName}
                  autoFocus
                />
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Opis (neobvezno)</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  placeholder="Kratek opis skupine..."
                  placeholderTextColor="#999"
                  value={newGroupDescription}
                  onChangeText={setNewGroupDescription}
                  multiline
                  numberOfLines={3}
                />
              </View>

              <TouchableOpacity
                style={styles.createButton}
                onPress={handleCreateGroup}
                activeOpacity={0.8}
              >
                <Text style={styles.createButtonText}>Ustvari skupino</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  header: {
    padding: 20,
    paddingTop: 60,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e1e8ed',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#2c3e50',
  },
  listContent: {
    padding: 16,
    paddingBottom: 100,
  },
  myTasksCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#E8F4FD',
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    borderWidth: 2,
    borderColor: '#4A90E2',
    shadowColor: '#4A90E2',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  myTasksLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  myTasksIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
    shadowColor: '#4A90E2',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 2,
  },
  myTasksTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 4,
  },
  myTasksSubtitle: {
    fontSize: 14,
    color: '#4A90E2',
  },
  groupCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    position: 'relative',
  },
  leaveButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    padding: 4,
    zIndex: 10,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  groupIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  groupInfo: {
    flex: 1,
  },
  groupName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#2c3e50',
    marginBottom: 4,
  },
  groupDescription: {
    fontSize: 14,
    color: '#7f8c8d',
  },
  groupFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  memberCount: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  memberCountText: {
    fontSize: 14,
    color: '#7f8c8d',
    marginLeft: 6,
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#4A90E2',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#4A90E2',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 20,
    paddingBottom: 40,
    paddingHorizontal: 20,
    minHeight: 400,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2c3e50',
  },
  modalForm: {
    gap: 20,
  },
  inputContainer: {
    marginBottom: 8,
  },
  inputLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2c3e50',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#2c3e50',
    borderWidth: 1,
    borderColor: '#e1e8ed',
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  createButton: {
    backgroundColor: '#4A90E2',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 12,
    shadowColor: '#4A90E2',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  createButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
})
