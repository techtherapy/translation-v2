import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import type { User } from '../types'
import { getStoredUser, isAuthenticated, logout as apiLogout } from '../api/auth'
import { getPermissions } from '../api/users'

interface AuthContextType {
  user: User | null
  isLoggedIn: boolean
  permissions: string[]
  setUser: (user: User | null) => void
  logout: () => void
  hasPermission: (key: string) => boolean
  refreshPermissions: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoggedIn: false,
  permissions: [],
  setUser: () => {},
  logout: () => {},
  hasPermission: () => false,
  refreshPermissions: async () => {},
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(getStoredUser)
  const [permissions, setPermissions] = useState<string[]>([])

  const loadPermissions = useCallback(async (currentUser: User | null) => {
    if (!currentUser) {
      setPermissions([])
      return
    }
    // Admin always has all permissions
    if (currentUser.role === 'admin') {
      setPermissions(['*'])
      return
    }
    try {
      const data = await getPermissions()
      setPermissions(data.role_permissions[currentUser.role] || [])
    } catch {
      setPermissions([])
    }
  }, [])

  useEffect(() => {
    if (user) {
      loadPermissions(user)
    }
  }, [user, loadPermissions])

  const logout = () => {
    apiLogout()
    setUser(null)
    setPermissions([])
  }

  const hasPermission = (key: string): boolean => {
    if (!user) return false
    if (user.role === 'admin') return true
    return permissions.includes(key)
  }

  const refreshPermissions = async () => {
    await loadPermissions(user)
  }

  return (
    <AuthContext.Provider value={{
      user,
      isLoggedIn: !!user,
      permissions,
      setUser,
      logout,
      hasPermission,
      refreshPermissions,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
