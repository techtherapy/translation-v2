import { useState, useEffect, useMemo } from 'react'
import { Loader2, RefreshCw, Save, Search, CheckCircle, AlertCircle, Star } from 'lucide-react'
import {
  getModelCatalog, updateEnabledModels, refreshModelCatalog,
  updateSettings,
  type CatalogModel,
} from '../../api/settings'
import { extractErrorMessage } from '../../utils/extractErrorMessage'

function formatCost(value: number | null): string {
  if (value === null || value === undefined) return '\u2014'
  if (value === 0) return '$0'
  if (value < 0.01) return `$${value.toFixed(4)}`
  if (value < 1) return `$${value.toFixed(2)}`
  return `$${value.toFixed(2)}`
}

const PROVIDERS_ORDER = ['anthropic', 'openai', 'deepseek', 'gemini']

export default function ModelsTab() {
  const [models, setModels] = useState<CatalogModel[]>([])
  const [providerKeys, setProviderKeys] = useState<Record<string, boolean>>({})
  const [defaultModel, setDefaultModel] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [filter, setFilter] = useState('')
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    loadCatalog()
  }, [])

  async function loadCatalog() {
    setLoading(true)
    try {
      const data = await getModelCatalog()
      setModels(data.models)
      setDefaultModel(data.default_model)
      const keys: Record<string, boolean> = {}
      for (const pk of data.provider_keys) {
        keys[pk.provider] = pk.api_key_set
      }
      setProviderKeys(keys)
      setDirty(false)
    } catch (err) {
      setMessage({ type: 'error', text: extractErrorMessage(err, 'Failed to load model catalog') })
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    setMessage(null)
    try {
      const enabledIds = models.filter((m) => m.enabled).map((m) => m.id)
      const result = await updateEnabledModels(enabledIds)
      setDirty(false)
      setMessage({ type: 'success', text: `Saved. ${result.enabled_count} models enabled.` })
    } catch (err) {
      setMessage({ type: 'error', text: extractErrorMessage(err, 'Failed to save') })
    } finally {
      setSaving(false)
    }
  }

  async function handleRefresh() {
    setRefreshing(true)
    setMessage(null)
    try {
      const result = await refreshModelCatalog()
      setMessage({ type: 'success', text: `Catalog refreshed with ${result.model_count} models. Reloading...` })
      await loadCatalog()
    } catch (err) {
      setMessage({ type: 'error', text: extractErrorMessage(err, 'Failed to refresh catalog') })
    } finally {
      setRefreshing(false)
    }
  }

  function toggleModel(id: string) {
    const model = models.find((m) => m.id === id)
    if (!model) return
    // Don't allow enabling if provider has no API key
    if (!model.enabled && !providerKeys[model.provider]) return

    setModels((prev) =>
      prev.map((m) => (m.id === id ? { ...m, enabled: !m.enabled } : m))
    )
    setDirty(true)
    setMessage(null)
  }

  function toggleProvider(provider: string) {
    // Don't allow enabling if provider has no API key
    if (!providerKeys[provider]) return

    const providerModels = models.filter((m) => m.provider === provider)
    const allEnabled = providerModels.every((m) => m.enabled)
    setModels((prev) =>
      prev.map((m) => (m.provider === provider ? { ...m, enabled: !allEnabled } : m))
    )
    setDirty(true)
    setMessage(null)
  }

  async function makeDefault(modelId: string) {
    setMessage(null)
    try {
      await updateSettings([{ key: 'DEFAULT_LLM_MODEL', value: modelId, updated_at: null }])
      setDefaultModel(modelId)
      setMessage({ type: 'success', text: `Default model set to ${modelId}` })
    } catch (err) {
      setMessage({ type: 'error', text: extractErrorMessage(err, 'Failed to set default model') })
    }
  }

  // Group by provider, filter by search term
  const lowerFilter = filter.toLowerCase().trim()

  const grouped = useMemo(() => {
    const groups: { provider: string; providerDisplay: string; apiKeySet: boolean; models: CatalogModel[]; enabledCount: number }[] = []

    for (const pk of PROVIDERS_ORDER) {
      const providerModels = models.filter(
        (m) =>
          m.provider === pk &&
          (!lowerFilter || m.id.toLowerCase().includes(lowerFilter) || m.name.toLowerCase().includes(lowerFilter))
      )
      if (providerModels.length === 0) continue
      groups.push({
        provider: pk,
        providerDisplay: providerModels[0]?.provider_display || pk,
        apiKeySet: providerKeys[pk] ?? false,
        models: providerModels,
        enabledCount: providerModels.filter((m) => m.enabled).length,
      })
    }
    return groups
  }, [models, lowerFilter, providerKeys])

  const totalEnabled = models.filter((m) => m.enabled).length
  const totalModels = models.length

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-gold" />
      </div>
    )
  }

  return (
    <div>
      {message && (
        <div
          className={`flex items-center gap-2 px-4 py-3 rounded-md text-sm font-body mb-4 ${
            message.type === 'success'
              ? 'bg-green-50 text-green-700 border border-green-200 dark:bg-status-success-bg/30 dark:text-status-success dark:border-green-800'
              : 'bg-red-50 text-red-700 border border-red-200 dark:bg-status-error-bg/30 dark:text-status-error dark:border-red-800'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle className="w-4 h-4 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0" />
          )}
          {message.text}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-parchment-400 dark:text-ink-400" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter models..."
            className="input-field pl-9 text-sm"
          />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-parchment-500 dark:text-cream-muted">
            {totalEnabled} of {totalModels} enabled
          </span>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="btn-secondary text-sm flex items-center gap-1.5"
            title="Fetch latest models from LiteLLM"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh Catalog
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            className="btn-primary text-sm flex items-center gap-1.5"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save
          </button>
        </div>
      </div>

      {/* Model table */}
      <div className="surface-glass overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-parchment-200 dark:border-ink-600/50">
              <th className="text-left px-4 py-3 font-medium text-parchment-500 dark:text-cream-muted w-12"></th>
              <th className="text-left px-4 py-3 font-medium text-parchment-500 dark:text-cream-muted">Model</th>
              <th className="text-left px-4 py-3 font-medium text-parchment-500 dark:text-cream-muted">ID</th>
              <th className="text-right px-4 py-3 font-medium text-parchment-500 dark:text-cream-muted">Input / 1M</th>
              <th className="text-right px-4 py-3 font-medium text-parchment-500 dark:text-cream-muted">Output / 1M</th>
              <th className="w-24"></th>
            </tr>
          </thead>
          <tbody>
            {grouped.map((group) => (
              <ProviderGroup
                key={group.provider}
                provider={group.provider}
                providerDisplay={group.providerDisplay}
                apiKeySet={group.apiKeySet}
                models={group.models}
                enabledCount={group.enabledCount}
                defaultModel={defaultModel}
                onToggleModel={toggleModel}
                onToggleProvider={toggleProvider}
                onMakeDefault={makeDefault}
              />
            ))}
          </tbody>
        </table>
        {grouped.length === 0 && (
          <div className="py-8 text-center text-parchment-400 dark:text-cream-muted/50">
            {filter ? 'No models match your filter' : 'No models in catalog'}
          </div>
        )}
      </div>
    </div>
  )
}

function ProviderGroup({
  provider,
  providerDisplay,
  apiKeySet,
  models,
  enabledCount,
  defaultModel,
  onToggleModel,
  onToggleProvider,
  onMakeDefault,
}: {
  provider: string
  providerDisplay: string
  apiKeySet: boolean
  models: CatalogModel[]
  enabledCount: number
  defaultModel: string
  onToggleModel: (id: string) => void
  onToggleProvider: (provider: string) => void
  onMakeDefault: (id: string) => void
}) {
  const allEnabled = enabledCount === models.length
  const someEnabled = enabledCount > 0 && !allEnabled

  return (
    <>
      {/* Provider header row */}
      <tr className="bg-parchment-50 dark:bg-ink-750 border-b border-parchment-200 dark:border-ink-700/50">
        <td className="px-4 py-2">
          <button
            onClick={() => onToggleProvider(provider)}
            disabled={!apiKeySet}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              !apiKeySet
                ? 'bg-parchment-200 dark:bg-ink-700 cursor-not-allowed'
                : allEnabled ? 'bg-gold' : someEnabled ? 'bg-gold/50' : 'bg-parchment-300 dark:bg-ink-600'
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                allEnabled || someEnabled ? 'translate-x-4.5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </td>
        <td colSpan={5} className="px-4 py-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-parchment-500 dark:text-cream-muted">
                {providerDisplay}
              </span>
              {apiKeySet ? (
                <span className="flex items-center gap-1 text-green-600 dark:text-green-400 text-[10px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                  Key set
                </span>
              ) : (
                <span className="flex items-center gap-1 text-parchment-400 dark:text-ink-400 text-[10px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-parchment-300 dark:bg-ink-600 inline-block" />
                  No key
                </span>
              )}
            </div>
            <span className="text-[10px] text-parchment-400 dark:text-ink-400">
              {enabledCount} / {models.length}
            </span>
          </div>
        </td>
      </tr>
      {/* Model rows */}
      {models.map((m) => {
        const isDefault = m.id === defaultModel
        const canEnable = apiKeySet
        return (
          <tr
            key={m.id}
            className={`group border-b border-parchment-100 dark:border-ink-700/30 transition-opacity ${
              !canEnable ? 'opacity-30' : !m.enabled ? 'opacity-50' : ''
            }`}
          >
            <td className="px-4 py-2.5">
              <button
                onClick={() => onToggleModel(m.id)}
                disabled={!canEnable}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  !canEnable
                    ? 'bg-parchment-200 dark:bg-ink-700 cursor-not-allowed'
                    : m.enabled ? 'bg-gold' : 'bg-parchment-300 dark:bg-ink-600'
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                    m.enabled ? 'translate-x-4.5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </td>
            <td className="px-4 py-2.5 text-ink-850 dark:text-cream">
              <div className="flex items-center gap-2">
                {m.name}
                {isDefault && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-gold/15 text-gold border border-gold/30">
                    <Star className="w-2.5 h-2.5 fill-current" />
                    Default
                  </span>
                )}
              </div>
            </td>
            <td className="px-4 py-2.5 font-mono text-xs text-parchment-500 dark:text-cream-muted">{m.id}</td>
            <td className="px-4 py-2.5 text-right font-mono text-xs text-parchment-500 dark:text-cream-muted">
              {formatCost(m.cost?.input_per_million ?? null)}
            </td>
            <td className="px-4 py-2.5 text-right font-mono text-xs text-parchment-500 dark:text-cream-muted">
              {formatCost(m.cost?.output_per_million ?? null)}
            </td>
            <td className="px-4 py-2.5 text-right">
              {m.enabled && canEnable && !isDefault && (
                <button
                  onClick={() => onMakeDefault(m.id)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-[11px] text-parchment-400 hover:text-gold dark:text-ink-400 dark:hover:text-gold px-2 py-1 rounded hover:bg-gold/10"
                >
                  Make Default
                </button>
              )}
            </td>
          </tr>
        )
      })}
    </>
  )
}
