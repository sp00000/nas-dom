import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Animated, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { supabase } from '../../../src/lib/supabase'

interface Task {
  id: string
  name: string
  difficulty: number
  groupId: string
  groupName: string
  groupColor: string
  assignedTo: string
  completed: boolean
  deadline?: string
  hoursRemaining?: number
  minutesRemaining?: number
  recurring: boolean
  originalDaysRemaining?: number
  confirmationCount?: number
  confirmedByCurrentUser?: boolean
}

type SortBy = 'deadline' | 'difficulty' | 'group'

export default function Tasks() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [filteredTasks, setFilteredTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  
  const [sortBy, setSortBy] = useState<SortBy>('deadline')
  const [selectedGroup, setSelectedGroup] = useState<string>('all')
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([])
  const [disappearingTaskIds, setDisappearingTaskIds] = useState<string[]>([])
  const taskAnimations = useRef<{ [key: string]: Animated.Value }>({}).current

  useEffect(() => {
    loadCurrentUser()
  }, [])

  useEffect(() => {
    if (currentUserId) {
      loadTasks()
    }
  }, [currentUserId])

  // Timer za osvežujevanje časa vsako minuto
  useEffect(() => {
    if (!currentUserId) return
    
    const interval = setInterval(() => {
      loadTasks()
    }, 60000) //1 minuta

    return () => clearInterval(interval)
  }, [currentUserId])

  useEffect(() => {
    applyFiltersAndSort()
  }, [tasks, sortBy, selectedGroup])

  const loadCurrentUser = async () => {
    const { data } = await supabase.auth.getUser()
    setCurrentUserId(data?.user?.id ?? null)
  }

  const loadTasks = async () => {
    if (!currentUserId) return

    try {
      setLoading(true)

      //skupine katerih je uporabnik član
      const { data: memberData } = await supabase
        .from('group_members')
        .select('group_id')
        .eq('user_id', currentUserId)

      const groupIds = (memberData ?? []).map((m: any) => m.group_id)

      if (groupIds.length === 0) {
        setTasks([])
        setGroups([])
        setLoading(false)
        return
      }

      //informacije o skupinah
      const { data: groupsData, error: groupsError } = await supabase
        .from('groups')
        .select('id, name')
        .in('id', groupIds)
      
      if (groupsError) {
        console.error('Error loading groups:', groupsError)
      }

      setGroups(groupsData ?? [])

      //vsa opravila iz teh skupin, ki so dodeljena trenutnemu uporabniku
      const { data: tasksData } = await supabase
        .from('tasks')
        .select('*')
        .in('group_id', groupIds)
        .eq('assigned_to', currentUserId)

      //naloži potrditve opravil
      const taskIds = (tasksData ?? []).map((t: any) => t.id)
      const { data: completions } = await supabase
        .from('task_completions')
        .select('task_id, user_id')
        .in('task_id', taskIds)

      const completionMap: Record<string, string[]> = {}
      ;(completions ?? []).forEach((c: any) => {
        if (!completionMap[c.task_id]) completionMap[c.task_id] = []
        completionMap[c.task_id].push(c.user_id)
      })

      // Pridobi ime profila
      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name, email')
        .eq('id', currentUserId)
        .single()

      const userName = profile?.display_name || profile?.email || 'Jaz'

      // opravila
      const mapped: Task[] = (tasksData ?? []).map((t: any) => {
        const group = groupsData?.find((g: any) => g.id === t.group_id)
        const confirmedUsers = completionMap[t.id] ?? []

        let hoursRemaining: number | undefined
        if (t.deadline) {
          const now = new Date()
          const deadline = new Date(t.deadline)
          const diff = deadline.getTime() - now.getTime()
          const totalMinutes = Math.max(0, Math.floor(diff / 60000))
          hoursRemaining = Math.floor(totalMinutes / 60)
        }

        return {
          id: t.id,
          name: t.name,
          difficulty: t.difficulty,
          groupId: t.group_id,
          groupName: group?.name ?? 'Neznana skupina',
          groupColor: '#4A90E2',
          assignedTo: userName,
          completed: !!t.completed,
          deadline: t.deadline,
          hoursRemaining,
          recurring: !!t.recurring,
          originalDaysRemaining: t.original_days_remaining,
          confirmationCount: confirmedUsers.length,
          confirmedByCurrentUser: confirmedUsers.includes(currentUserId),
        }
      })

      setTasks(mapped)
    } catch (error) {
      console.error('Error loading tasks:', error)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  const applyFiltersAndSort = () => {
    let filtered = [...tasks]

    // Filtriraj po skupini
    if (selectedGroup !== 'all') {
      filtered = filtered.filter(t => t.groupId === selectedGroup)
    }

    // Razvrsti
    if (sortBy === 'deadline') {
      filtered.sort((a, b) => {
        if (!a.deadline && !b.deadline) return 0
        if (!a.deadline) return 1
        if (!b.deadline) return -1
        return new Date(a.deadline).getTime() - new Date(b.deadline).getTime()
      })
    } else if (sortBy === 'difficulty') {
      filtered.sort((a, b) => b.difficulty - a.difficulty)
    } else if (sortBy === 'group') {
      filtered.sort((a, b) => a.groupName.localeCompare(b.groupName))
    }

    setFilteredTasks(filtered)
  }

  const onRefresh = () => {
    setRefreshing(true)
    loadTasks()
  }

  const toggleTaskCompletion = async (taskId: string) => {
    if (!currentUserId || disappearingTaskIds.includes(taskId)) return

    const task = tasks.find(t => t.id === taskId)
    if (!task) return

    // Preklopi potrditev uporabnika
    if (task.completed) {
      //Označeno kot neopravljeno --> nazaj na aktivno
      await supabase
        .from('tasks')
        .update({ completed: false })
        .eq('id', taskId)
      
      await loadTasks()
    } else {
      //Označi kot opravljeno
      await supabase
        .from('tasks')
        .update({ completed: true })
        .eq('id', taskId)

      await adjustMemberCompletedStars(currentUserId, task.difficulty || 0)

      await loadTasks()//osvežimo seznam

      // Če je ponavljajoče počakaj in resetiraj
      if (task.recurring) {
        setTimeout(async () => {
          if (!taskAnimations[taskId]) {
            taskAnimations[taskId] = new Animated.Value(1)
          }
          setDisappearingTaskIds([...disappearingTaskIds, taskId])

          Animated.timing(taskAnimations[taskId], {
            toValue: 0,
            duration: 800,
            useNativeDriver: true,
          }).start()

          setTimeout(async () => {
            try {
              // Resetiraj opravilo
              const newDeadline = new Date()
              newDeadline.setDate(newDeadline.getDate() + (task.originalDaysRemaining || 7))
              
              await supabase
                .from('tasks')
                .update({ 
                  completed: false, 
                  deadline: newDeadline.toISOString()
                })
                .eq('id', taskId)
            } catch {}

            await loadTasks()
            setDisappearingTaskIds(prev => prev.filter(id => id !== taskId))
            delete taskAnimations[taskId]
          }, 900)
        }, 1000)
      } else {
        // Neponavljajoče: animiraj in izbriši
        setTimeout(async () => {
          if (!taskAnimations[taskId]) {
            taskAnimations[taskId] = new Animated.Value(1)
          }
          setDisappearingTaskIds([...disappearingTaskIds, taskId])

          Animated.timing(taskAnimations[taskId], {
            toValue: 0,
            duration: 800,
            useNativeDriver: true,
          }).start()

          setTimeout(async () => {
            try {
              await supabase
                .from('tasks')
                .delete()
                .eq('id', taskId)
            } catch {}

            await loadTasks()
            setDisappearingTaskIds(prev => prev.filter(id => id !== taskId))
            delete taskAnimations[taskId]
          }, 900)
        }, 1000)
      }
    }
  }

  const adjustMemberCompletedStars = async (memberId: string, delta: number) => {
    if (!memberId) return
    
    // Preberi trenutno vrednost iz baze za vse skupine
    const { data: memberGroups } = await supabase
      .from('group_members')
      .select('group_id')
      .eq('user_id', memberId)
    
    const groupIds = (memberGroups ?? []).map((m: any) => m.group_id)
    
    // Posodobi statistike za vse skupine
    for (const groupId of groupIds) {
      const { data: currentMember } = await supabase
        .from('group_members')
        .select('completed_stars')
        .eq('group_id', groupId)
        .eq('user_id', memberId)
        .single()
      
      const currentStars = currentMember?.completed_stars ?? 0
      const newStars = currentStars + delta
      
      await supabase
        .from('group_members')
        .update({ completed_stars: newStars })
        .eq('group_id', groupId)
        .eq('user_id', memberId)
    }
  }

  const renderDifficultyStars = (difficulty: number) => {
    return (
      <View style={styles.stars}>
        {[1, 2, 3, 4, 5].map((star) => (
          <Ionicons
            key={star}
            name={star <= difficulty ? 'star' : 'star-outline'}
            size={12}
            color={star <= difficulty ? '#F39C12' : '#ddd'}
          />
        ))}
      </View>
    )
  }

  const renderTask = ({ item: task }: { item: Task }) => {
    return (
      <TouchableOpacity
        style={styles.taskCard}
        onPress={() => router.push(`/group/${task.groupId}`)}
        activeOpacity={0.7}
      >
        <View style={styles.taskLeft}>
          <TouchableOpacity
            style={[
              styles.checkbox, 
              task.completed && styles.checkboxChecked
            ]}
            onPress={() => router.push(`/group/${task.groupId}`)}
            activeOpacity={0.7}
          >
            {task.completed && <Ionicons name="checkmark" size={18} color="#fff" />}
          </TouchableOpacity>

          <View style={styles.taskInfo}>
            <Text style={[styles.taskName, task.completed && styles.taskNameCompleted]}>
              {task.name}
            </Text>

            <View style={styles.taskMeta}>
              {renderDifficultyStars(task.difficulty)}
              
              {task.confirmationCount !== undefined && task.confirmationCount > 0 && (
                <View style={styles.confirmationBadge}>
                  <Ionicons name="checkmark-circle" size={12} color="#4A90E2" />
                  <Text style={styles.confirmationText}>{task.confirmationCount}</Text>
                </View>
              )}
            </View>

            <View style={styles.groupTag}>
              <View style={[styles.groupColorDot, { backgroundColor: task.groupColor }]} />
              <Text style={styles.groupName}>{task.groupName}</Text>
            </View>
          </View>
        </View>

        {task.deadline && !task.completed && (
          <View style={styles.deadlineContainer}>
            <Ionicons name="time-outline" size={16} color="#7f8c8d" />
            <Text style={[styles.deadlineText, { color: '#7f8c8d' }]}>
              {(() => {
                const now = new Date()
                const deadline = new Date(task.deadline)
                const diffMs = deadline.getTime() - now.getTime()
                const totalMinutes = Math.max(0, Math.floor(diffMs / 60000))
                const hours = Math.floor(totalMinutes / 60)
                const minutes = totalMinutes % 60
                return `${hours}h ${minutes}m`
              })()}
            </Text>
          </View>
        )}
      </TouchableOpacity>
    )
  }

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#4A90E2" />
        <Text style={styles.loadingText}>Nalagam naloge...</Text>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      {/* Filters */}
      <View style={styles.filtersContainer}>
        {/* Sort & Group Filter */}
        <View style={styles.filterRow}>
          <View style={styles.sortContainer}>
            <Ionicons name="swap-vertical" size={16} color="#7f8c8d" />
            <TouchableOpacity onPress={() => {
              const sorts: SortBy[] = ['deadline', 'difficulty', 'group']
              const currentIndex = sorts.indexOf(sortBy)
              setSortBy(sorts[(currentIndex + 1) % sorts.length])
            }}>
              <Text style={styles.sortText}>
                {sortBy === 'deadline' && 'Po roku'}
                {sortBy === 'difficulty' && 'Po težavnosti'}
                {sortBy === 'group' && 'Po skupini'}
              </Text>
            </TouchableOpacity>
          </View>

          {groups.length > 1 && (
            <TouchableOpacity
              style={styles.groupFilterButton}
              onPress={() => {
                const allGroups = ['all', ...groups.map(g => g.id)]
                const currentIndex = allGroups.indexOf(selectedGroup)
                setSelectedGroup(allGroups[(currentIndex + 1) % allGroups.length])
              }}
            >
              <Ionicons name="filter" size={16} color="#4A90E2" />
              <Text style={styles.groupFilterText}>
                {selectedGroup === 'all'
                  ? 'Vse skupine'
                  : groups.find(g => g.id === selectedGroup)?.name || 'Skupina'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Task List */}
      <FlatList
        data={filteredTasks}
        renderItem={renderTask}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.tasksList}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={['#4A90E2']}
            tintColor="#4A90E2"
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="checkmark-done-circle-outline" size={80} color="#ddd" />
            <Text style={styles.emptyTitle}>Ni nalog</Text>
            <Text style={styles.emptySubtitle}>
              Nove naloge se ti bodo prikazale tukaj
            </Text>
          </View>
        }
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#7f8c8d',
  },
  filtersContainer: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e1e8ed',
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#f8f9fa',
    borderWidth: 1,
    borderColor: '#e1e8ed',
  },
  filterChipActive: {
    backgroundColor: '#4A90E2',
    borderColor: '#4A90E2',
  },
  filterChipText: {
    fontSize: 14,
    color: '#7f8c8d',
    fontWeight: '500',
  },
  filterChipTextActive: {
    color: '#fff',
  },
  sortContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#f8f9fa',
    borderRadius: 16,
  },
  sortText: {
    fontSize: 14,
    color: '#2c3e50',
    fontWeight: '500',
  },
  groupFilterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#E8F4FD',
    borderRadius: 16,
    marginLeft: 'auto',
  },
  groupFilterText: {
    fontSize: 14,
    color: '#4A90E2',
    fontWeight: '500',
  },
  tasksList: {
    padding: 20,
  },
  taskCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e1e8ed',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  taskLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  checkbox: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#ddd',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  checkboxChecked: {
    backgroundColor: '#50C878',
    borderColor: '#50C878',
  },
  checkboxConfirmed: {
    backgroundColor: '#E8F4FD',
    borderColor: '#4A90E2',
  },
  taskInfo: {
    flex: 1,
  },
  taskName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2c3e50',
    marginBottom: 6,
  },
  taskNameCompleted: {
    textDecorationLine: 'line-through',
    color: '#7f8c8d',
  },
  taskMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  stars: {
    flexDirection: 'row',
    gap: 2,
  },
  confirmationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#E8F4FD',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  confirmationText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#4A90E2',
  },
  groupTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  groupColorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  groupName: {
    fontSize: 13,
    color: '#7f8c8d',
  },
  deadlineContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
  },
  deadlineText: {
    fontSize: 13,
    fontWeight: '600',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#7f8c8d',
    textAlign: 'center',
    paddingHorizontal: 40,
  },
})
