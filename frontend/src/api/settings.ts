import api from './client'

export interface SettingValue {
  key: string
  value: string
  updated_at: string | null
}

export async function getSettings(): Promise<SettingValue[]> {
  const { data } = await api.get('/settings')
  return data.settings
}

export async function getPublicSettings(): Promise<SettingValue[]> {
  const { data } = await api.get('/settings/public')
  return data.settings
}

export async function updateSettings(settings: SettingValue[]): Promise<SettingValue[]> {
  const { data } = await api.put('/settings', { settings })
  return data.settings
}

export interface ModelCost {
  input_per_million: number | null
  output_per_million: number | null
}

export interface ModelInfo {
  id: string
  name: string
  cost?: ModelCost | null
}

export interface ProviderModels {
  provider: string
  api_key_set: boolean
  models: ModelInfo[]
}

export async function getAvailableModels(): Promise<ProviderModels[]> {
  const { data } = await api.get('/settings/available-models')
  return data.providers
}

// ── Model Catalog (admin) ──────────────────────────────────

export interface CatalogModel {
  id: string
  name: string
  provider: string
  provider_display: string
  enabled: boolean
  cost: ModelCost | null
}

export interface ProviderKeyStatus {
  provider: string
  api_key_set: boolean
}

export interface ModelCatalogData {
  models: CatalogModel[]
  provider_keys: ProviderKeyStatus[]
  default_model: string
}

export async function getModelCatalog(): Promise<ModelCatalogData> {
  const { data } = await api.get('/settings/model-catalog')
  return data
}

export async function updateEnabledModels(modelIds: string[]): Promise<{ enabled_count: number }> {
  const { data } = await api.put('/settings/enabled-models', { model_ids: modelIds })
  return data
}

export async function refreshModelCatalog(): Promise<{ model_count: number }> {
  const { data } = await api.post('/settings/refresh-model-catalog')
  return data
}

// ── Prompt Templates ──────────────────────────────────

export interface PromptTemplate {
  key: string
  label: string
  value: string
  is_default: boolean
}

export async function getPromptTemplates(): Promise<PromptTemplate[]> {
  const { data } = await api.get('/settings/prompts')
  return data.prompts
}

export async function updatePromptTemplates(prompts: { key: string; value: string }[]): Promise<{ updated: number }> {
  const { data } = await api.put('/settings/prompts', { prompts })
  return data
}
