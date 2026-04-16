import api from './client'
import type { User } from '../types'

export async function login(username: string, password: string): Promise<{ token: string; user: User }> {
  const params = new URLSearchParams()
  params.append('username', username)
  params.append('password', password)

  const { data } = await api.post('/auth/login', params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })

  // Store token
  localStorage.setItem('token', data.access_token)

  // Fetch user info
  const userRes = await api.get('/auth/me')
  const user = userRes.data
  localStorage.setItem('user', JSON.stringify(user))

  return { token: data.access_token, user }
}

export function logout() {
  localStorage.removeItem('token')
  localStorage.removeItem('user')
}

export function getStoredUser(): User | null {
  const stored = localStorage.getItem('user')
  if (!stored) return null
  try {
    return JSON.parse(stored)
  } catch {
    return null
  }
}

export function isAuthenticated(): boolean {
  return !!localStorage.getItem('token')
}
