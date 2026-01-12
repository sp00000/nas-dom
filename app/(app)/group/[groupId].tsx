import { Ionicons } from '@expo/vector-icons'
import { useLocalSearchParams } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { Alert, Animated, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { supabase } from '../../../src/lib/supabase'

interface Member {
  id: string
  name: string
  email: string
  avatar: string
  completedCount: number
  completedStars: number
  isOwner: boolean
  overdueCount: number
}

interface Task {
  id: string
  name: string
  difficulty: number
  createdBy: string
  assignedTo: string
  assignedToId: string
  completed: boolean
  daysRemaining: number
  recurring: boolean
  originalDaysRemaining: number
  deadline?: string
  hoursRemaining?: number
  isOverdue?: boolean
}

export default function GroupDetail() {
  const { groupId } = useLocalSearchParams()
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  const [members, setMembers] = useState<Member[]>([])

  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(false)

  const [memberModalVisible, setMemberModalVisible] = useState(false)
  const [taskModalVisible, setTaskModalVisible] = useState(false)
  const [profileModalVisible, setProfileModalVisible] = useState(false)
  const [selectedProfileMemberId, setSelectedProfileMemberId] = useState<string | null>(null)
  const [groupOwnerId, setGroupOwnerId] = useState<string | null>(null)
  const [disappearingTaskIds, setDisappearingTaskIds] = useState<string[]>([])
  const taskAnimations = useRef<{ [key: string]: Animated.Value }>({}).current
  const [profileRefreshTrigger, setProfileRefreshTrigger] = useState(0)

  const maxCompletedStars = members.reduce((max, m) => Math.max(max, m.completedStars ?? 0), 0)

  const adjustMemberCompletedCount = async (memberId: string | undefined, delta: number) => {
    if (!memberId || !groupId) return
    
    // Preberi trenutno vrednost iz baze
    const { data: currentStats } = await supabase
      .from('group_member_stats')
      .select('completed_count')
      .eq('group_id', groupId as string)
      .eq('user_id', memberId)
      .single()
    
    const currentCount = currentStats?.completed_count ?? 0
    const newCount = Math.max(0, currentCount + delta)
    
    // Posodobi v bazi
    await supabase
      .from('group_member_stats')
      .upsert({ 
        group_id: groupId as string,
        user_id: memberId,
        completed_count: newCount 
      }, { onConflict: 'group_id,user_id' })
    
    // Posodobi lokalno stanje
    setMembers(prev => prev.map(m => m.id === memberId
      ? { ...m, completedCount: newCount }
      : m
    ))
  }

  const adjustMemberCompletedStars = async (memberId: string | undefined, delta: number) => {
    if (!memberId || !groupId) return
    
    // Preberi trenutno vrednost iz baze
    const { data: currentStats } = await supabase
      .from('group_member_stats')
      .select('completed_stars')
      .eq('group_id', groupId as string)
      .eq('user_id', memberId)
      .single()
    
    const currentStars = currentStats?.completed_stars ?? 0
    const newStars = currentStars + delta
    
    // Posodobi v bazi
    await supabase
      .from('group_member_stats')
      .upsert({ 
        group_id: groupId as string,
        user_id: memberId,
        completed_stars: newStars 
        }, { onConflict: 'group_id,user_id' })
    
    // Posodobi lokalno stanje
    setMembers(prev => prev.map(m => m.id === memberId
      ? { ...m, completedStars: newStars }
      : m
    ))
  }

  const adjustMemberOverdueCount = async (memberId: string | undefined, delta: number) => {
    if (!memberId || !groupId) return
    
    // Preberi trenutno vrednost iz baze
    const { data: currentStats } = await supabase
      .from('group_member_stats')
      .select('overdue_count')
      .eq('group_id', groupId as string)
      .eq('user_id', memberId)
      .single()
    
    const currentOverdue = currentStats?.overdue_count ?? 0
    const newOverdue = Math.max(0, currentOverdue + delta)
    
    // Posodobi v bazi
    await supabase
      .from('group_member_stats')
      .upsert({ 
        group_id: groupId as string,
        user_id: memberId,
        overdue_count: newOverdue 
      }, { onConflict: 'group_id,user_id' })
    
    // Posodobi lokalno stanje
    setMembers(prev => prev.map(m => m.id === memberId
      ? { ...m, overdueCount: newOverdue }
      : m
    ))
  }
  const [newMemberEmail, setNewMemberEmail] = useState('')
  const [newTaskName, setNewTaskName] = useState('')
  const [newTaskDifficulty, setNewTaskDifficulty] = useState(3)
  const [selectedMemberId, setSelectedMemberId] = useState<string>('')
  const [newTaskDays, setNewTaskDays] = useState('7')
  const [newTaskRecurring, setNewTaskRecurring] = useState(true)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [processedOverdueTasks, setProcessedOverdueTasks] = useState<Set<string>>(new Set())
  const [newTaskDeadlineDate, setNewTaskDeadlineDate] = useState<string>('')
  const [newTaskDeadlineTime, setNewTaskDeadlineTime] = useState<string>('')

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser()
      setCurrentUserId(data?.user?.id ?? null)
    })()
  }, [])

  // Ponovno naloži opravila, ko se `currentUserId` spremeni (po prijavi)
  useEffect(() => {
    if (currentUserId && groupId) {
      loadTasks()
    }
  }, [currentUserId, groupId])

  const handleOverdueTask = async (task: Task) => {
    // Obravnava neopravljeno opravilo
    try {
      if (task.recurring) {
        // Ponavljajoče: resetiraj brez brisanja
        const newDeadline = new Date()
        newDeadline.setDate(newDeadline.getDate() + task.originalDaysRemaining)
        
        await supabase
          .from('tasks')
          .update({ 
            days_remaining: task.originalDaysRemaining, 
            completed: false,
            deadline: newDeadline.toISOString()
          })
          .eq('id', task.id)
        
        // kazen za dodieljeno opravilo
        if (task.assignedToId) {
          await adjustMemberOverdueCount(task.assignedToId, 1)
          await adjustMemberCompletedStars(task.assignedToId, -(task.difficulty || 0))
        }
      } else {
        // Neponavljajoče: izbriši opravilo
        await supabase.from('tasks').delete().eq('id', task.id)
        
        // kazen - vedno se odbijejo zvezdice lastniku
        if (task.assignedToId) {
          await adjustMemberOverdueCount(task.assignedToId, 1)
          await adjustMemberCompletedStars(task.assignedToId, -(task.difficulty || 0))
        }
      }
    } catch (error) {
      console.error('Error handling overdue task:', error)
    }
  }

  const checkAndHandleOverdueTasks = async (tasksToCheck: Task[]) => {
    // Preveri vsa opravila in obravnava neopravljene (potekle roke)
    const now = new Date()
    let hadOverdue = false

    for (const task of tasksToCheck) {
      
      if (!task.deadline) continue // Preskoči če nima roka
      if (task.completed) continue // Preskoči že opravljena opravila – ne kaznujemo completed
      if (processedOverdueTasks.has(task.id)) continue  // Preskoči če smo že obravnavali to opravilo

      const deadline = new Date(task.deadline)
      if (deadline <= now) {
        // Opravilo je poteklo in ni opravljeno – obravnavaj ga
        await handleOverdueTask(task)
        // Označi kot obravnavano
        setProcessedOverdueTasks(prev => new Set(prev).add(task.id))
        hadOverdue = true
      }
    }
    
    // Če smo našli in obravnavali neopravljena opravila, ponovno naloži
    if (hadOverdue) {
      // Ponovno naloži podatke iz baze
      const { data: updatedData } = await supabase
        .from('tasks')
        .select('*')
        .eq('group_id', groupId)
      
      if (updatedData) {
        // Ponovno mapiramo opravila
        const assignedToIds = updatedData
          .filter((t: any) => t.assigned_to)
          .map((t: any) => t.assigned_to)
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, display_name, email')
          .in('id', assignedToIds)
        
        const idToName: Record<string, string> = {}
        ;(profiles ?? []).forEach(p => {
          idToName[p.id] = p.display_name || p.email
        })
        
        const mapped: Task[] = updatedData.map((t: any) => {
          let hoursRemaining: number | undefined
          let isOverdue = false
          let deadline = t.deadline
          
          // Če opravilo nima deadline, izračunaj ga
          if (!deadline && t.created_at) {
            const createdAt = new Date(t.created_at)
            const deadlineDate = new Date(createdAt)
            deadlineDate.setDate(deadlineDate.getDate() + (t.days_remaining || 0))
            deadline = deadlineDate.toISOString()
          }
          
          if (deadline) {
            const now = new Date()
            const deadlineDate = new Date(deadline)
            const diff = deadlineDate.getTime() - now.getTime()
            hoursRemaining = Math.max(0, Math.floor(diff / (1000*60*60)))
            isOverdue = !t.completed && deadlineDate < now
          }
          
          return {
            id: t.id,
            name: t.name,
            difficulty: t.difficulty,
            createdBy: t.created_by ?? '—',
            assignedTo: t.assigned_to ? (idToName[t.assigned_to] ?? 'Nedodeljeno') : 'Nedodeljeno',
            assignedToId: t.assigned_to ?? '',
            completed: !!t.completed,
            daysRemaining: t.days_remaining,
            recurring: !!t.recurring,
            originalDaysRemaining: t.original_days_remaining,
            deadline,
            hoursRemaining,
            isOverdue,
          }
        })
        
        // Filtriraj duplikate - ohrani samo prvi task z isto ID-ja
        const uniqueTasksMap = new Map<string, Task>()
        mapped.forEach(task => {
          if (!uniqueTasksMap.has(task.id)) {
            uniqueTasksMap.set(task.id, task)
          }
        })
        const uniqueTasks = Array.from(uniqueTasksMap.values())
        
        setTasks(uniqueTasks)
      }
    }
  }

  const loadMembers = async () => {
    if (!groupId) return
    
    // Pridobi owner_id iz groups tabele
    const { data: groupData, error: groupError } = await supabase
      .from('groups')
      .select('owner_id')
      .eq('id', groupId)
      .single()
    
    if (groupError) {
      console.warn('Failed to load group:', groupError.message)
      return
    }
    
    setGroupOwnerId(groupData?.owner_id ?? null)
    
    const { data: gm, error } = await supabase
      .from('group_members')
      .select('user_id')
      .eq('group_id', groupId)
    if (error) {
      console.warn('Failed to load members:', error.message)
      return
    }
    const ids = (gm ?? []).map((x: any) => x.user_id)
    if (ids.length === 0) {
      setMembers([])
      return
    }
    const { data: profs, error: perr } = await supabase
      .from('profiles')
      .select('id, email, display_name, avatar_url')
      .in('id', ids)
    if (perr) {
      console.warn('Failed to load profiles:', perr.message)
      return
    }
    
    // Naloži group-specific statistike
    const { data: stats, error: staterr } = await supabase
      .from('group_member_stats')
      .select('user_id, completed_count, completed_stars, overdue_count')
      .eq('group_id', groupId)
      .in('user_id', ids)
    if (staterr) {
      console.warn('Failed to load group member stats:', staterr.message)
      return
    }
    
    const statsMap: Record<string, any> = {}
    ;(stats ?? []).forEach((s: any) => {
      statsMap[s.user_id] = s
    })
    
    const mapped = (profs ?? []).map((p: any) => {
      const memberStats = statsMap[p.id] || { completed_count: 0, completed_stars: 0, overdue_count: 0 }
      return {
        id: p.id,
        name: p.display_name ?? p.email,
        email: p.email,
        avatar: '👤',
        completedCount: memberStats.completed_count ?? 0,
        completedStars: memberStats.completed_stars ?? 0,
        isOwner: p.id === groupData?.owner_id,
        overdueCount: memberStats.overdue_count ?? 0,
      }
    })
    setMembers(mapped)
  }

  const loadTasks = async () => {
    if (!groupId) return
    setLoading(true)
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('group_id', groupId)
    if (error) {
      console.warn('Failed to load tasks:', error.message)
      setLoading(false)
      return
    }
    
    // PRVO: Preveri in obravnaj pretekla opravila PRED mapiranjem
    const now = new Date()
    let needsReload = false
    
    for (const t of (data ?? [])) {
      let deadline = t.deadline
      
      // če nima roka ga izračunaj
      if (!deadline && t.created_at) {
        const createdAt = new Date(t.created_at)
        const deadlineDate = new Date(createdAt)
        deadlineDate.setDate(deadlineDate.getDate() + (t.days_remaining || 0))
        deadline = deadlineDate.toISOString()
      }
        
        // Preveri je deadline pretečen i opravilo nije završeno
      if (deadline && !t.completed) {
        const deadlineDate = new Date(deadline)
        if (deadlineDate <= now && !processedOverdueTasks.has(t.id)) {
          // Opravilo je preteklo - obdelaj ga
          const taskData: Task = {
            id: t.id,
            name: t.name,
            difficulty: t.difficulty,
            createdBy: t.created_by ?? '—',
            assignedTo: t.assigned_to ? 'Nedodeljeno' : 'Nedodeljeno',
            assignedToId: t.assigned_to ?? '',
            completed: !!t.completed,
            daysRemaining: t.days_remaining,
            recurring: !!t.recurring,
            originalDaysRemaining: t.original_days_remaining,
            deadline,
          }
          
          await handleOverdueTask(taskData)
          setProcessedOverdueTasks(prev => new Set(prev).add(t.id))
          needsReload = true
        }
      }
    }
    
    // Če je bilo preteklih opravil, ponovno naloži
    if (needsReload) {
      const { data: reloadedData } = await supabase
        .from('tasks')
        .select('*')
        .eq('group_id', groupId)
      
      if (reloadedData) {
        // NE kličemo loadMembers() tukaj, ker smo že posodobili lokalno stanje
        // v adjustMemberOverdueCount in adjustMemberCompletedStars funkcijah
        
        // Nastavi data na osvežene podatke
        Object.assign(data, reloadedData)
      }
    }
    
    // DRUGO: Naloži imena profilov neposredno iz baze
    const assignedToIds = (data ?? [])
      .filter((t: any) => t.assigned_to)
      .map((t: any) => t.assigned_to)
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, display_name, email')
      .in('id', assignedToIds)
    
    const idToName: Record<string, string> = {}
    ;(profiles ?? []).forEach(p => {
      idToName[p.id] = p.display_name || p.email
    })
    
    const mapped: Task[] = (data ?? []).map((t: any) => {
      //izracun ur in preverjanje roka
      let hoursRemaining: number | undefined
      let isOverdue = false
      let deadline = t.deadline
      
      // Če opravilo nima deadline, izračunaj ga glede na days_remaining
      if (!deadline && t.created_at) {
        const createdAt = new Date(t.created_at)
        const deadlineDate = new Date(createdAt)
        deadlineDate.setDate(deadlineDate.getDate() + (t.days_remaining || 0))
        deadline = deadlineDate.toISOString()
        
        // Posodobi v bazi da ga ne računamo znova
        supabase
          .from('tasks')
          .update({ deadline })
          .eq('id', t.id)
          .then(() => {})
      }
      
      if (deadline) {
        const now = new Date()
        const deadlineDate = new Date(deadline)
        const diff = deadlineDate.getTime() - now.getTime()
        hoursRemaining = Math.max(0, Math.floor(diff / (1000*60*60)))
        isOverdue = !t.completed && deadlineDate <= now
        // Če je že poteklo, ga ne renderiramo (bo obdelano v checkAndHandleOverdueTasks)
        if (isOverdue) return null
      }
      
      return {
        id: t.id,
        name: t.name,
        difficulty: t.difficulty,
        createdBy: t.created_by ?? '—',
        assignedTo: t.assigned_to ? (idToName[t.assigned_to] ?? 'Nedodeljeno') : 'Nedodeljeno',
        assignedToId: t.assigned_to ?? '',
        completed: !!t.completed,
        daysRemaining: t.days_remaining,
        recurring: !!t.recurring,
        originalDaysRemaining: t.original_days_remaining,
        deadline,
        hoursRemaining,
        isOverdue,
      }
    }).filter(Boolean) as Task[]
    
    // Filtriraj duplikate - ohrani samo prvi task z isto ID-ja
    const uniqueTasksMap = new Map<string, Task>()
    mapped.forEach(task => {
      if (!uniqueTasksMap.has(task.id)) {
        uniqueTasksMap.set(task.id, task)
      }
    })
    const uniqueTasks = Array.from(uniqueTasksMap.values())
    
    setTasks(uniqueTasks)
    
    // Preverj in obravnaj neopravljena opravila
    await checkAndHandleOverdueTasks(mapped)
    
    setLoading(false)
  }

  useEffect(() => {
    (async () => { await loadMembers() })()
  }, [groupId])

  // Timer za osvežujevanje časa in preverjanje overdue opravil vsako minuto
  useEffect(() => {
    if (!groupId || !currentUserId) return
    
    // Osvežuj vsako minuto (60 sekund)
    const interval = setInterval(() => {
      loadTasks()
      // Sprožimo refresh tudi za profil modal (da se časi osvežijo)
      setProfileRefreshTrigger(prev => prev + 1)
    }, 60000) // 60000ms = 1 minuta

    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, currentUserId])

  // Realtime posodobitve za opravila in člane skupine
  useEffect(() => {
    if (!groupId) return
    const channel = supabase
      .channel(`group-${groupId}-realtime`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `group_id=eq.${groupId}` }, () => {
        loadTasks()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members', filter: `group_id=eq.${groupId}` }, () => {
        loadMembers()
      })
      .subscribe()

    return () => {
      try { supabase.removeChannel(channel) } catch {}
    }
  }, [groupId])

  const handleAddMember = async () => {
    if (!newMemberEmail.trim()) {
      Alert.alert('Napaka', 'Prosim vnesite e-pošto uporabnika')
      return
    }

    try {
      // Poišči uporabnika po e-pošti
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('id, email, display_name')
        .eq('email', newMemberEmail.trim().toLowerCase())
        .single()

      if (profileError || !profileData) {
        Alert.alert('Napaka', 'Uporabnik s tem e-poštnim naslovom ne obstaja')
        return
      }

      // Preveri, ali je uporabnik že član
      const { data: existingMember } = await supabase
        .from('group_members')
        .select('id')
        .eq('group_id', groupId)
        .eq('user_id', profileData.id)
        .single()

      if (existingMember) {
        Alert.alert('Napaka', 'Ta uporabnik je že član skupine')
        return
      }

      // Dodaj uporabnika v skupino
      const { error: insertError } = await supabase
        .from('group_members')
        .insert({
          group_id: groupId,
          user_id: profileData.id
        })

      if (insertError) {
        Alert.alert('Napaka', 'Napaka pri dodajanju člana')
        return
      }

      await loadMembers()
      setNewMemberEmail('')
      setMemberModalVisible(false)
      Alert.alert('Uspeh', `${profileData.display_name || profileData.email} je bil dodan v skupino`)
    } catch (error) {
      console.error('Error adding member:', error)
      Alert.alert('Napaka', 'Napaka pri dodajanju člana')
    }
  }

  const handleDeleteMember = async (memberId: string) => {
    // Preveri, ali je trenutni uporabnik lastnik grupe
    if (currentUserId !== groupOwnerId) {
      Alert.alert('Napaka', 'Samo lastnik grupe može brisati člane')
      return
    }

    // Preveri, da lastnik ne briše sam sebe
    if (memberId === groupOwnerId) {
      Alert.alert('Napaka', 'Lastnik ne more izbrisati sam sebe')
      return
    }

    Alert.alert(
      'Izbriši člana',
      'Ali ste prepričani, da želite izbrisati tega člana iz grupe?',
      [
        { text: 'Prekliči', style: 'cancel' },
        {
          text: 'Izbriši',
          style: 'destructive',
          onPress: async () => {
            try {
              const { error } = await supabase
                .from('group_members')
                .delete()
                .eq('group_id', groupId)
                .eq('user_id', memberId)

              if (error) {
                Alert.alert('Napaka', 'Napaka pri brisanju člana')
                return
              }

              await loadMembers()
              setProfileModalVisible(false)
              Alert.alert('Uspeh', 'Član je bil izbrisan iz grupe')
            } catch (error) {
              console.error('Error deleting member:', error)
              Alert.alert('Napaka', 'Napaka pri brisanju člana')
            }
          }
        }
      ]
    )
  }

  const handleOpenEditTask = (task: Task) => {
    setEditingTaskId(task.id)
    setNewTaskName(task.name)
    setNewTaskDifficulty(task.difficulty)
    setSelectedMemberId(task.assignedToId)
    setNewTaskRecurring(task.recurring)
    
    // Nastavi datum in uro iz deadline-a
    if (task.deadline) {
      const deadlineDate = new Date(task.deadline)
      const dateStr = deadlineDate.toISOString().split('T')[0]
      const timeStr = `${String(deadlineDate.getHours()).padStart(2, '0')}:${String(deadlineDate.getMinutes()).padStart(2, '0')}`
      setNewTaskDeadlineDate(dateStr)
      setNewTaskDeadlineTime(timeStr)
    }
    
    setTaskModalVisible(true)
  }

  const handleDeleteTask = (taskId: string) => {
    Alert.alert(
      'Izbriši opravilo',
      'Ali ste prepričani, da želite izbrisati to opravilo?',
      [
        { text: 'Prekliči', style: 'cancel' },
        {
          text: 'Izbriši',
          style: 'destructive',
          onPress: async () => {
            const taskToDelete = tasks.find(t => t.id === taskId)
            if (taskToDelete?.completed) {
              await adjustMemberCompletedCount(taskToDelete.assignedToId, -1)
              await adjustMemberCompletedStars(taskToDelete.assignedToId, -(taskToDelete.difficulty || 0))
            }
            try {
              await supabase.from('tasks').delete().eq('id', taskId)
            } finally {
              setTasks(tasks.filter(t => t.id !== taskId))
            }
          }
        }
      ]
    )
  }

  const handleAddTask = async () => {
    if (!newTaskName.trim()) {
      Alert.alert('Napaka', 'Prosim vnesite ime opravila')
      return
    }
    
    if (!newTaskDeadlineDate || !newTaskDeadlineTime) {
      Alert.alert('Napaka', 'Prosim nastavite datum in uro')
      return
    }

    // Validiraj format datuma (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/
    if (!dateRegex.test(newTaskDeadlineDate)) {
      Alert.alert('Napaka', 'Neveljaven format datuma. Uporabite YYYY-MM-DD (npr. 2026-01-15)')
      return
    }

    // Validiraj format ure (HH:MM)
    const timeRegex = /^\d{2}:\d{2}$/
    if (!timeRegex.test(newTaskDeadlineTime)) {
      Alert.alert('Napaka', 'Neveljaven format ure. Uporabite HH:MM (npr. 14:30)')
      return
    }

    const selectedMember = members.find(m => m.id === selectedMemberId)

    // Izračunaj deadline iz datuma in časa
    const [year, month, day] = newTaskDeadlineDate.split('-').map(Number)
    const [hours, minutes] = newTaskDeadlineTime.split(':').map(Number)
    
    // Validiraj vrednosti
    if (isNaN(year) || isNaN(month) || isNaN(day) || isNaN(hours) || isNaN(minutes)) {
      Alert.alert('Napaka', 'Neveljaven datum ali ura')
      return
    }
    
    if (month < 1 || month > 12 || day < 1 || day > 31 || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      Alert.alert('Napaka', 'Datum ali ura izven dovoljenega obsega')
      return
    }
    
    const deadline = new Date(year, month - 1, day, hours, minutes)
    
    // Preveri da je datum veljaven (npr. 31. februar ne obstaja)
    if (isNaN(deadline.getTime())) {
      Alert.alert('Napaka', 'Neveljaven datum')
      return
    }
    
    // Preveri da je datum v prihodnosti
    const now = new Date()
    if (deadline <= now) {
      Alert.alert('Napaka', 'Rok mora biti v prihodnosti. Prosim izberite datum in uro v prihodnosti.')
      return
    }
    
    // Izračunaj days_remaining od deadline-a
    const diffMs = deadline.getTime() - now.getTime()
    const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
    const originalDaysRemaining = daysRemaining > 0 ? daysRemaining : 1

    if (editingTaskId) {
      // Uredi obstoječe opravilo
      const updatePayload: any = {
        name: newTaskName.trim(),
        difficulty: newTaskDifficulty,
        assigned_to: selectedMemberId || null,
        days_remaining: daysRemaining,
        original_days_remaining: originalDaysRemaining,
        recurring: newTaskRecurring,
        deadline: deadline.toISOString(),
      }
      const { error } = await supabase.from('tasks').update(updatePayload).eq('id', editingTaskId)
      if (error) {
        // Fallback to local update
        setTasks(tasks.map(task => 
          task.id === editingTaskId
            ? {
                ...task,
                name: newTaskName.trim(),
                difficulty: newTaskDifficulty,
                assignedTo: selectedMember?.name || 'Nedodeljeno',
                assignedToId: selectedMemberId,
                daysRemaining: daysRemaining,
                originalDaysRemaining: originalDaysRemaining,
                recurring: newTaskRecurring,
              }
            : task
        ))
      } else {
        await loadTasks()
      }
    } else {
      // Ustvari novo opravilo
      const insertPayload: any = {
        group_id: groupId,
        name: newTaskName.trim(),
        difficulty: newTaskDifficulty,
        created_by: currentUserId ?? null,
        assigned_to: selectedMemberId || null,
        completed: false,
        days_remaining: daysRemaining,
        recurring: newTaskRecurring,
        original_days_remaining: originalDaysRemaining,
        deadline: deadline.toISOString(),
      }
      const { data, error } = await supabase.from('tasks').insert(insertPayload).select().single()
      if (error || !data) {
        // Fallback to local add
        const newTask: Task = {
          id: Date.now().toString(),
          name: newTaskName.trim(),
          difficulty: newTaskDifficulty,
          createdBy: 'Jaz',
          assignedTo: selectedMember?.name || 'Nedodeljeno',
          assignedToId: selectedMemberId,
          completed: false,
          daysRemaining: daysRemaining,
          recurring: newTaskRecurring,
          originalDaysRemaining: originalDaysRemaining
        }
        setTasks([...tasks, newTask])
      } else {
        await loadTasks()
      }
    }

    setNewTaskName('')
    setNewTaskDifficulty(3)
    setSelectedMemberId('')
    setNewTaskDays('7')
    setNewTaskRecurring(true)
    setEditingTaskId(null)
    setNewTaskDeadlineDate('')
    setNewTaskDeadlineTime('')
    setTaskModalVisible(false)
  }

  const handleCloseTaskModal = () => {
    setNewTaskName('')
    setNewTaskDifficulty(3)
    setSelectedMemberId('')
    setNewTaskDays('7')
    setNewTaskRecurring(true)
    setEditingTaskId(null)
    setNewTaskDeadlineDate('')
    setNewTaskDeadlineTime('')
    setTaskModalVisible(false)
  }

  const toggleTaskCompletion = async (taskId: string) => {
    if (disappearingTaskIds.includes(taskId) || !currentUserId) return

    const task = tasks.find(t => t.id === taskId)
    if (!task) return

    // Nedodeljeno opravilo lahko opravi kdor koli
    // Dodeljeno opravilo lahko opravi samo dodeljeni član
    if (task.assignedToId && task.assignedToId !== currentUserId) {
      Alert.alert('Napaka', 'Samo dodeljeni član lahko opravi to opravilo')
      return
    }

    // Preklopi potrditev uporabnika
    if (task.completed) {
      // Označeno kot neopravljeno - nazaj na aktivno
      await supabase
        .from('tasks')
        .update({ completed: false })
        .eq('id', taskId)
      // Odstrani iz processedOverdueTasks da se lahko spet obravnava kot overdue
      setProcessedOverdueTasks(prev => {
        const newSet = new Set(prev)
        newSet.delete(taskId)
        return newSet
      })
      await loadTasks()
    } else {
      // Označi kot opravljeno
      // Najprej posodobi bazo da je completed
      await supabase
        .from('tasks')
        .update({ completed: true })
        .eq('id', taskId)
      
      // Odstrani iz processedOverdueTasks ker je sedaj opravljeno
      setProcessedOverdueTasks(prev => {
        const newSet = new Set(prev)
        newSet.delete(taskId)
        return newSet
      })

      // Posodobi statistiko -_> ČAKAJ DA SE ZAKLJUČI
      //dodelimo zvezdice uoprabniku
      await adjustMemberCompletedCount(currentUserId, 1)
      await adjustMemberCompletedStars(currentUserId, task.difficulty || 0)

      // Osveži seznam da se prikaže checkmark
      await loadTasks()

      // Če je ponavljajoče opravilo počakaj in resetiraj
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
              //Resetiraj opravilo
              const newDeadline = new Date()
              newDeadline.setDate(newDeadline.getDate() + task.originalDaysRemaining)
              
              await supabase
                .from('tasks')
                .update({ 
                  completed: false, 
                  days_remaining: task.originalDaysRemaining,
                  deadline: newDeadline.toISOString()
                })
                .eq('id', taskId)
            } catch {}

            await loadTasks()
            setDisappearingTaskIds(prev => prev.filter(id => id !== taskId))
            delete taskAnimations[taskId]
          }, 900)
        }, 1000) //Počakaj 1 sekundo da uporabnik vidi opravljeno opravilo
      } else {
        //Neponavljajoče: animiraj in izbriši
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
              //Izbriši neponavljajoče opravilo iz baze
              await supabase
                .from('tasks')
                .delete()
                .eq('id', taskId)
            } catch {}

            await loadTasks()
            setDisappearingTaskIds(prev => prev.filter(id => id !== taskId))
            delete taskAnimations[taskId]
          }, 900)
        }, 1000) //Počakaj 1 sekundo da uporabnik vidi opravljeno opravilo
      }
    }
  }

  const renderDifficultyStars = (difficulty: number) => {
    return (
      <View style={styles.starsContainer}>
        {[1, 2, 3, 4, 5].map((star) => (
          <Ionicons
            key={star}
            name={star <= difficulty ? "star" : "star-outline"}
            size={16}
            color="#F39C12"
          />
        ))}
      </View>
    )
  }

  const renderDifficultySelector = () => {
    return (
      <View style={styles.difficultySelector}>
        {[1, 2, 3, 4, 5].map((level) => (
          <TouchableOpacity
            key={level}
            style={[
              styles.difficultyButton,
              newTaskDifficulty === level && styles.difficultyButtonActive
            ]}
            onPress={() => setNewTaskDifficulty(level)}
          >
            <Ionicons
              name="star"
              size={24}
              color={newTaskDifficulty >= level ? "#F39C12" : "#ddd"}
            />
          </TouchableOpacity>
        ))}
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Oddelek članov */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Člani</Text>
            <TouchableOpacity
              style={styles.addButton}
              onPress={() => setMemberModalVisible(true)}
            >
              <Ionicons name="person-add" size={20} color="#4A90E2" />
              <Text style={styles.addButtonText}>Dodaj</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.membersGrid}>
            {members.map((member) => (
              <TouchableOpacity 
                key={member.id} 
                style={[
                  styles.memberCard,
                  (maxCompletedStars > 0 && (member.completedStars ?? 0) === maxCompletedStars) && styles.memberCardTop
                ]}
                onPress={() => {
                  setSelectedProfileMemberId(member.id)
                  setProfileModalVisible(true)
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.memberAvatar}>{member.avatar}</Text>
                <Text style={styles.memberName}>{member.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Oddelek opravil */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Opravila</Text>
            <TouchableOpacity
              style={styles.addButton}
              onPress={() => {
                setEditingTaskId(null)
                setNewTaskName('')
                setNewTaskDifficulty(3)
                setSelectedMemberId('')
                setNewTaskRecurring(true)
                
                // Nastavi default datum in uro (jutri ob 09:00)
                const tomorrow = new Date()
                tomorrow.setDate(tomorrow.getDate() + 1)
                const dateStr = tomorrow.toISOString().split('T')[0]
                setNewTaskDeadlineDate(dateStr)
                setNewTaskDeadlineTime('09:00')
                
                setTaskModalVisible(true)
              }}
            >
              <Ionicons name="add-circle" size={20} color="#4A90E2" />
              <Text style={styles.addButtonText}>Dodaj</Text>
            </TouchableOpacity>
          </View>

          {tasks
            .sort((a, b) => {
              //Razporedi po času do roka --> najprej tista z najmanj časa
              if (!a.deadline && !b.deadline) return 0
              if (!a.deadline) return 1 //Opravila brez roka na konec
              if (!b.deadline) return -1
              
              const now = new Date()
              const timeA = new Date(a.deadline).getTime() - now.getTime()
              const timeB = new Date(b.deadline).getTime() - now.getTime()
              
              return timeA - timeB //Manjši čas (bolj nujno) pride prej
            })
            .map((task) => {
            const isDisappearing = disappearingTaskIds.includes(task.id)
            const animationValue = taskAnimations[task.id] || new Animated.Value(1)
            //Izračun preostalega časa (ure in minute) do roka
            let timeDisplay = 'Ni roka'
            let isUrgent = false
            if (task.deadline) {
              const now = new Date()
              const diffMs = new Date(task.deadline).getTime() - now.getTime()
              const totalMinutes = Math.max(0, Math.floor(diffMs / 60000))
              const hours = Math.floor(totalMinutes / 60)
              const minutes = totalMinutes % 60
              timeDisplay = `${hours}h ${minutes}m`
              isUrgent = hours < 24
            }
            
            return (
            <Animated.View 
              key={task.id} 
              style={[
                styles.taskCard,
                {
                  opacity: animationValue,
                  transform: [
                    {
                      scale: animationValue.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.8, 1],
                      }),
                    },
                  ],
                },
              ]}
            >
              <TouchableOpacity
                style={styles.taskLeft}
                onPress={() => toggleTaskCompletion(task.id)}
                activeOpacity={0.7}
                disabled={!!task.assignedToId && task.assignedToId !== currentUserId}
              >
                <View style={[
                  styles.checkbox, 
                  task.completed && styles.checkboxChecked,
                  !!task.assignedToId && task.assignedToId !== currentUserId && styles.checkboxDisabled
                ]}>
                  {task.completed && <Ionicons name="checkmark" size={18} color="#fff" />}
                </View>
                <View style={styles.taskInfo}>
                  <Text style={[styles.taskName, task.completed && styles.taskNameCompleted]}>
                    {task.name}
                  </Text>
                  <View style={styles.taskMeta}>
                    {renderDifficultyStars(task.difficulty)}
                    <Text style={styles.taskCreator}>• {task.assignedTo}</Text>
                  </View>
                  <View style={styles.taskDeadline}>
                    <Ionicons name="time-outline" size={14} color="#7f8c8d" />
                    <Text style={styles.taskDeadlineText}>
                      {timeDisplay}
                    </Text>
                  </View>
                  <View style={styles.taskType}>
                    <Ionicons 
                      name={task.recurring ? "repeat" : "checkmark-done"} 
                      size={14} 
                      color={task.recurring ? "#4A90E2" : "#7f8c8d"} 
                    />
                    <Text style={styles.taskTypeText}>
                      {task.recurring ? 'Ponavljajoče' : 'Neponavljajoče'}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.taskMenu}
                onPress={() => handleOpenEditTask(task)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="ellipsis-vertical" size={20} color="#7f8c8d" />
              </TouchableOpacity>
            </Animated.View>
            )
          })}
        </View>
      </ScrollView>

      {/*dodajanje člana*/}
      <Modal
        animationType="slide"
        transparent={true}
        visible={memberModalVisible}
        onRequestClose={() => setMemberModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Dodaj člana</Text>
              <TouchableOpacity onPress={() => setMemberModalVisible(false)}>
                <Ionicons name="close" size={28} color="#2c3e50" />
              </TouchableOpacity>
            </View>

            <View style={styles.modalForm}>
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>E-pošta uporabnika</Text>
                <TextInput
                  style={styles.input}
                  placeholder="uporabnik@example.com"
                  placeholderTextColor="#999"
                  value={newMemberEmail}
                  onChangeText={setNewMemberEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoFocus
                />
              </View>

              <TouchableOpacity
                style={styles.submitButton}
                onPress={handleAddMember}
                activeOpacity={0.8}
              >
                <Text style={styles.submitButtonText}>Povabi</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/*dodajanje opravila*/}
      <Modal
        animationType="slide"
        transparent={true}
        visible={taskModalVisible}
        onRequestClose={() => setTaskModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editingTaskId ? 'Uredi opravilo' : 'Novo opravilo'}</Text>
              <TouchableOpacity onPress={handleCloseTaskModal}>
                <Ionicons name="close" size={28} color="#2c3e50" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalFormScroll} showsVerticalScrollIndicator={false}>
              <View style={styles.modalForm}>
                <View style={styles.inputContainer}>
                  <Text style={styles.inputLabel}>Ime opravila</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="npr. Pomivanje posode"
                    placeholderTextColor="#999"
                    value={newTaskName}
                    onChangeText={setNewTaskName}
                    autoFocus
                  />
                </View>

                <View style={styles.inputContainer}>
                  <Text style={styles.inputLabel}>Težavnost</Text>
                  {renderDifficultySelector()}
                  <Text style={styles.difficultyHint}>
                    {newTaskDifficulty === 1 && "Zelo enostavno"}
                    {newTaskDifficulty === 2 && "Enostavno"}
                    {newTaskDifficulty === 3 && "Srednje"}
                    {newTaskDifficulty === 4 && "Težko"}
                    {newTaskDifficulty === 5 && "Zelo težko"}
                  </Text>
                </View>

                <View style={styles.inputContainer}>
                  <Text style={styles.inputLabel}>Rok trajanja</Text>
                  
                  <TextInput
                    style={styles.input}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor="#999"
                    value={newTaskDeadlineDate}
                    onChangeText={setNewTaskDeadlineDate}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="HH:MM"
                    placeholderTextColor="#999"
                    value={newTaskDeadlineTime}
                    onChangeText={setNewTaskDeadlineTime}
                  />
                  <Text style={styles.difficultyHint}>
                    Opravilo mora biti opravljeno {newTaskDeadlineDate} ob {newTaskDeadlineTime || '00:00'}
                  </Text>
                </View>

                <View style={styles.inputContainer}>
                  <Text style={styles.inputLabel}>Tip opravila</Text>
                  <View style={styles.recurringSelector}>
                    <TouchableOpacity
                      style={[
                        styles.recurringOption,
                        newTaskRecurring && styles.recurringOptionSelected
                      ]}
                      onPress={() => setNewTaskRecurring(true)}
                    >
                      <Ionicons 
                        name="repeat" 
                        size={24} 
                        color={newTaskRecurring ? "#4A90E2" : "#7f8c8d"} 
                      />
                      <Text style={[
                        styles.recurringOptionText,
                        newTaskRecurring && styles.recurringOptionTextSelected
                      ]}>
                        Ponavljajoče
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.recurringOption,
                        !newTaskRecurring && styles.recurringOptionSelected
                      ]}
                      onPress={() => setNewTaskRecurring(false)}
                    >
                      <Ionicons 
                        name="checkmark-done" 
                        size={24} 
                        color={!newTaskRecurring ? "#4A90E2" : "#7f8c8d"} 
                      />
                      <Text style={[
                        styles.recurringOptionText,
                        !newTaskRecurring && styles.recurringOptionTextSelected
                      ]}>
                        Neponavljajoče
                      </Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.difficultyHint}>
                    {newTaskRecurring 
                      ? 'Po opravljanju se rok resetira in opravilo ostane aktivno' 
                      : 'Po opravljanju opravilo izgine'}
                  </Text>
                </View>

                <View style={styles.inputContainer}>
                  <Text style={styles.inputLabel}>Dodeli članu (neobvezno)</Text>
                  <View style={styles.memberSelector}>
                    <TouchableOpacity
                      style={[
                        styles.memberOption,
                        selectedMemberId === '' && styles.memberOptionSelected
                      ]}
                      onPress={() => setSelectedMemberId('')}
                    >
                      <Text style={styles.memberOptionAvatar}>👤</Text>
                      <Text style={[
                        styles.memberOptionName,
                        selectedMemberId === '' && styles.memberOptionNameSelected
                      ]}>
                        Nedodeljeno
                      </Text>
                      {selectedMemberId === '' && (
                        <Ionicons name="checkmark-circle" size={20} color="#4A90E2" />
                      )}
                    </TouchableOpacity>
                    {members.map((member) => (
                      <TouchableOpacity
                        key={member.id}
                        style={[
                          styles.memberOption,
                          selectedMemberId === member.id && styles.memberOptionSelected
                        ]}
                        onPress={() => setSelectedMemberId(member.id)}
                      >
                        <Text style={styles.memberOptionAvatar}>{member.avatar}</Text>
                        <Text style={[
                          styles.memberOptionName,
                          selectedMemberId === member.id && styles.memberOptionNameSelected
                        ]}>
                          {member.name}
                        </Text>
                        {selectedMemberId === member.id && (
                          <Ionicons name="checkmark-circle" size={20} color="#4A90E2" />
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                <View style={styles.modalButtons}>
                  <TouchableOpacity
                    style={styles.submitButton}
                    onPress={handleAddTask}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.submitButtonText}>
                      {editingTaskId ? 'Shrani spremembe' : 'Dodaj opravilo'}
                    </Text>
                  </TouchableOpacity>
                  
                  {editingTaskId && (
                    <TouchableOpacity
                      style={styles.deleteButton}
                      onPress={() => {
                        handleCloseTaskModal()
                        handleDeleteTask(editingTaskId)
                      }}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="trash-outline" size={20} color="#fff" />
                      <Text style={styles.deleteButtonText}>Izbriši</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/*profil člana */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={profileModalVisible}
        onRequestClose={() => setProfileModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Profil člana</Text>
              <TouchableOpacity onPress={() => setProfileModalVisible(false)}>
                <Ionicons name="close" size={28} color="#2c3e50" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalFormScroll} showsVerticalScrollIndicator={false}>
              <View style={styles.profileContainer}>
                {(() => {
                  const member = members.find(m => m.id === selectedProfileMemberId)
                  if (!member) return null
                  
                  const completedCount = member.completedCount || 0
                  const completedStars = member.completedStars || 0
                  const overdueCount = member.overdueCount || 0
                  const activeCount = tasks.filter(t => t.assignedToId === member.id && !t.completed).length
                  const memberTasks = tasks.filter(t => t.assignedToId === member.id)

                  return (
                    <>
                      <View style={styles.profileAvatar}>
                        <Text style={styles.profileAvatarText}>{member.avatar}</Text>
                      </View>
                      <Text style={styles.profileName}>{member.name}</Text>
                      <Text style={styles.profileEmail}>{member.email}</Text>

                      {member.isOwner && (
                        <View style={styles.okvirLatnika}>
                          <Text style={styles.lastnikText}>lastnik skupine</Text>
                        </View>
                      )}

                      <View style={styles.profileStats}>
                        <View style={styles.statItem}>
                          <Text style={styles.statNumber}>{completedCount}</Text>
                          <Text style={styles.statLabel}>Opravljenih nalog</Text>
                        </View>
                        <View style={styles.statDivider} />
                        <View style={styles.statItem}>
                          <Text style={styles.statNumber}>{completedStars}</Text>
                          <Text style={styles.statLabel}>Zbrane zvezdice</Text>
                        </View>
                        <View style={styles.statDivider} />
                        <View style={styles.statItem}>
                          <Text style={styles.statNumber}>{activeCount}</Text>
                          <Text style={styles.statLabel}>Aktivnih nalog</Text>
                        </View>
                      </View>

                      <View style={[styles.profileStats, { backgroundColor: overdueCount > 0 ? '#FFE5E5' : '#f8f9fa' }]}>
                        <View style={styles.statItem}>
                          <Text style={[styles.statNumber, overdueCount > 0 && { color: '#FF6B6B' }]}>{overdueCount}</Text>
                          <Text style={styles.statLabel}>Neopravljena opravila</Text>
                        </View>
                      </View>

                      <View style={styles.profileSection}>
                        <Text style={styles.profileSectionTitle}>Dodeljene naloge</Text>
                        {memberTasks.map((task) => {
                          //Izračun časa do izteka naloge
                          let timeDisplay = 'Ni roka'
                          if (task.deadline) {
                            const now = new Date()
                            const deadline = new Date(task.deadline)
                            const diffMs = deadline.getTime() - now.getTime()
                            const totalMinutes = Math.max(0, Math.floor(diffMs / 60000))
                            const hours = Math.floor(totalMinutes / 60)
                            const minutes = totalMinutes % 60
                            timeDisplay = `${hours}h ${minutes}m`
                          }
                          
                          return (
                            <View key={task.id} style={styles.assignedTaskItem}>
                              <View style={[styles.taskStatusDot, task.completed && styles.taskStatusDotCompleted]} />
                              <View style={styles.assignedTaskInfo}>
                                <Text style={[styles.assignedTaskName, task.completed && styles.assignedTaskNameCompleted]}>
                                  {task.name}
                                </Text>
                                <Text style={styles.assignedTaskDays}>
                                  Rok: {timeDisplay}
                                </Text>
                              </View>
                            </View>
                          )
                        })}
                        {memberTasks.length === 0 && (
                          <Text style={styles.noTasksText}>Ni dodeljenega nalog</Text>
                        )}
                      </View>

                      {currentUserId === groupOwnerId && member.id !== groupOwnerId && (
                        <TouchableOpacity
                          style={[styles.deleteButton, { paddingHorizontal: 32 }]}
                          onPress={() => handleDeleteMember(member.id)}
                          activeOpacity={0.8}
                        >
                          <Text style={styles.deleteButtonText}>Odstrani člana</Text>
                        </TouchableOpacity>
                      )}
                    </>
                  )
                })()}
              </View>
            </ScrollView>
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 20,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e1e8ed',
  },
  backButton: {
    padding: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2c3e50',
  },
  placeholder: {
    width: 40,
  },
  content: {
    flex: 1,
  },
  section: {
    padding: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#2c3e50',
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  addButtonText: {
    fontSize: 16,
    color: '#4A90E2',
    fontWeight: '600',
  },
  membersGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  memberCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    width: '30%',
  },
  memberCardTop: {
    borderWidth: 2,
    borderColor: '#F39C12',
    shadowColor: '#F39C12',
    shadowOpacity: 0.25,
  },
  memberAvatar: {
    fontSize: 32,
    marginBottom: 8,
  },
  memberName: {
    fontSize: 12,
    color: '#2c3e50',
    fontWeight: '500',
    textAlign: 'center',
  },
  taskCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  taskLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  taskMenu: {
    padding: 8,
    marginLeft: 8,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#4A90E2',
    marginRight: 12,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  checkboxChecked: {
    backgroundColor: '#4A90E2',
    borderColor: '#4A90E2',
  },
  checkboxConfirmed: {
    borderColor: '#4A90E2',
    backgroundColor: '#D0E8F7',
  },
  checkboxDisabled: {
    borderColor: '#ccc',
    backgroundColor: '#f0f0f0',
    opacity: 0.5,
  },
  taskInfo: {
    flex: 1,
  },
  taskName: {
    fontSize: 16,
    color: '#2c3e50',
    fontWeight: '500',
    marginBottom: 6,
  },
  taskNameCompleted: {
    textDecorationLine: 'line-through',
    color: '#7f8c8d',
  },
  taskMeta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  starsContainer: {
    flexDirection: 'row',
    gap: 2,
  },
  taskCreator: {
    fontSize: 12,
    color: '#7f8c8d',
    marginLeft: 8,
  },
  taskConfirmations: {
    fontSize: 12,
    color: '#4A90E2',
    marginLeft: 8,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    flex: 1,
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 20,
    paddingBottom: 40,
    paddingHorizontal: 20,
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
    paddingHorizontal: 4,
  },
  modalFormScroll: {
    flex: 1,
    marginBottom: 12,
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
  difficultySelector: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e1e8ed',
  },
  difficultyButton: {
    padding: 8,
  },
  difficultyButtonActive: {
    transform: [{ scale: 1.2 }],
  },
  difficultyHint: {
    textAlign: 'center',
    marginTop: 8,
    fontSize: 14,
    color: '#7f8c8d',
    fontWeight: '500',
  },
  submitButton: {
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
  submitButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  memberSelector: {
    gap: 8,
  },
  memberOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    padding: 16,
    borderWidth: 2,
    borderColor: '#e1e8ed',
  },
  memberOptionSelected: {
    borderColor: '#4A90E2',
    backgroundColor: '#E8F4FD',
  },
  memberOptionAvatar: {
    fontSize: 24,
    marginRight: 12,
  },
  memberOptionName: {
    flex: 1,
    fontSize: 16,
    color: '#2c3e50',
    fontWeight: '500',
  },
  memberOptionNameSelected: {
    color: '#4A90E2',
    fontWeight: '600',
  },
  taskDeadline: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 4,
  },
  taskDeadlineText: {
    fontSize: 12,
    color: '#7f8c8d',
    fontStyle: 'italic',
  },
  taskDeadlineUrgent: {
    color: '#FF6B6B',
    fontWeight: '600',
  },
  taskType: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 4,
  },
  taskTypeText: {
    fontSize: 11,
    color: '#7f8c8d',
  },
  deadlineToggle: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  deadlineOption: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#e1e8ed',
    alignItems: 'center',
  },
  deadlineOptionActive: {
    borderColor: '#4A90E2',
    backgroundColor: '#E8F4FD',
  },
  deadlineOptionText: {
    fontSize: 13,
    color: '#7f8c8d',
    fontWeight: '500',
  },
  deadlineOptionTextActive: {
    color: '#4A90E2',
    fontWeight: '600',
  },
  recurringSelector: {
    flexDirection: 'row',
    gap: 12,
  },
  recurringOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    padding: 16,
    borderWidth: 2,
    borderColor: '#e1e8ed',
    gap: 8,
  },
  recurringOptionSelected: {
    borderColor: '#4A90E2',
    backgroundColor: '#E8F4FD',
  },
  recurringOptionText: {
    fontSize: 14,
    color: '#7f8c8d',
    fontWeight: '500',
  },
  recurringOptionTextSelected: {
    color: '#4A90E2',
    fontWeight: '600',
  },
  modalButtons: {
    gap: 12,
  },
  deleteButton: {
    backgroundColor: '#FF6B6B',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    shadowColor: '#FF6B6B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  deleteButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  profileContainer: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  profileAvatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#E8F4FD',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  profileAvatarText: {
    fontSize: 50,
  },
  profileName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 8,
  },
  profileEmail: {
    fontSize: 14,
    color: '#7f8c8d',
    marginBottom: 24,
  },
  okvirLatnika: {
    backgroundColor: '#FFE5B4',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginBottom: 16,
    alignItems: 'center',
  },
  lastnikText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#D97706',
  },
  profileStats: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 16,
    marginBottom: 24,
    width: '100%',
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#4A90E2',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: '#7f8c8d',
    textAlign: 'center',
  },
  statDivider: {
    width: 1,
    height: 40,
    backgroundColor: '#e1e8ed',
    marginHorizontal: 12,
  },
  profileSection: {
    width: '100%',
    marginTop: 12,
    marginBottom: 16,
  },
  profileSectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2c3e50',
    marginBottom: 12,
  },
  assignedTaskItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
  },
  taskStatusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#4A90E2',
    marginRight: 12,
  },
  taskStatusDotCompleted: {
    backgroundColor: '#50C878',
  },
  assignedTaskInfo: {
    flex: 1,
  },
  assignedTaskName: {
    fontSize: 14,
    fontWeight: '500',
    color: '#2c3e50',
    marginBottom: 4,
  },
  assignedTaskNameCompleted: {
    textDecorationLine: 'line-through',
    color: '#7f8c8d',
  },
  assignedTaskDays: {
    fontSize: 12,
    color: '#7f8c8d',
  },
  noTasksText: {
    fontSize: 14,
    color: '#7f8c8d',
    textAlign: 'center',
    fontStyle: 'italic',
    paddingVertical: 20,
  },
})
