import api from './client'
import type { User, RolePermissions } from '../types'

export interface UserCreateData {
  username: string
  email: string
  password: string
  full_name: string
  role: 'admin' | 'translator' | 'reviewer'
}

export interface UserUpdateData {
  full_name?: string
  role?: string
  is_active?: boolean
}

export async function listUsers(): Promise<User[]> {
  const { data } = await api.get('/auth/users')
  return data
}

export async function createUser(userData: UserCreateData): Promise<User> {
  const { data } = await api.post('/auth/users', userData)
  return data
}

export async function updateUser(userId: number, updates: UserUpdateData): Promise<User> {
  const { data } = await api.patch(`/auth/users/${userId}`, updates)
  return data
}

export async function resetUserPassword(userId: number, newPassword: string): Promise<void> {
  await api.post(`/auth/users/${userId}/reset-password`, { new_password: newPassword })
}

export async function changeMyPassword(currentPassword: string, newPassword: string): Promise<void> {
  await api.post('/auth/change-password', {
    current_password: currentPassword,
    new_password: newPassword,
  })
}

export async function getPermissions(): Promise<RolePermissions> {
  const { data } = await api.get('/settings/permissions')
  return data
}

export async function updatePermissions(rolePermissions: Record<string, string[]>): Promise<RolePermissions> {
  const { data } = await api.put('/settings/permissions', { role_permissions: rolePermissions })
  return data
}
