import React, { useState } from 'react'
import { BookOpen, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react'
import type { DetectedTerm } from '../../api/glossary'
import type { QAIssue } from '../../api/qa'

interface Props {
  detectedTerms: DetectedTerm[]
  qaIssues: QAIssue[]
  onAddTerm?: (sourceTerm: string) => void
  sourceFontClass?: string
}

type Tab = 'glossary' | 'qa'

export default function EditorBottomPanel({ detectedTerms, qaIssues, onAddTerm, sourceFontClass = 'font-chinese' }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('glossary')
  const [collapsed, setCollapsed] = useState(false)

  const missingCount = qaIssues.filter((i) => !i.found).length

  return (
    <div className="border-t border-parchment-300 dark:border-ink-600/50 bg-parchment-50 dark:bg-ink-900 flex flex-col shrink-0">
      {/* Tab bar */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-parchment-200 dark:border-ink-700/50">
        <div className="flex items-center gap-1">
          <button
            onClick={() => { setActiveTab('glossary'); setCollapsed(false) }}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium font-body rounded transition-colors ${
              activeTab === 'glossary' && !collapsed
                ? 'bg-gold/10 text-gold dark:bg-gold-faint/30'
                : 'text-parchment-400 dark:text-cream-muted hover:text-ink-850 dark:hover:text-cream'
            }`}
          >
            <BookOpen className="w-3 h-3" />
            Glossary
            {detectedTerms.length > 0 && (
              <span className="bg-gold/20 text-gold text-[10px] px-1.5 rounded-full font-semibold">
                {detectedTerms.length}
              </span>
            )}
          </button>
          <button
            onClick={() => { setActiveTab('qa'); setCollapsed(false) }}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium font-body rounded transition-colors ${
              activeTab === 'qa' && !collapsed
                ? 'bg-gold/10 text-gold dark:bg-gold-faint/30'
                : 'text-parchment-400 dark:text-cream-muted hover:text-ink-850 dark:hover:text-cream'
            }`}
          >
            <AlertTriangle className="w-3 h-3" />
            QA
            {missingCount > 0 && (
              <span className="bg-amber-100 text-amber-700 dark:bg-status-warning-bg dark:text-status-warning text-[10px] px-1.5 rounded-full font-semibold">
                {missingCount}
              </span>
            )}
          </button>
        </div>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="text-parchment-400 dark:text-cream-muted hover:text-ink-850 dark:hover:text-cream p-1 transition-colors"
        >
          {collapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Panel content */}
      {!collapsed && (
        <div className="h-[180px] overflow-y-auto">
          {activeTab === 'glossary' && (
            <GlossaryTab terms={detectedTerms} onAddTerm={onAddTerm} sourceFontClass={sourceFontClass} />
          )}
          {activeTab === 'qa' && (
            <QATab issues={qaIssues} sourceFontClass={sourceFontClass} />
          )}
        </div>
      )}
    </div>
  )
}


function GlossaryTab({ terms, onAddTerm, sourceFontClass = 'font-chinese' }: { terms: DetectedTerm[]; onAddTerm?: (s: string) => void; sourceFontClass?: string }) {
  if (terms.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-parchment-400 dark:text-cream-muted/60 font-body">
        Select a segment to see glossary terms
      </div>
    )
  }

  return (
    <table className="w-full text-xs font-body">
      <thead className="sticky top-0 bg-parchment-50 dark:bg-ink-900">
        <tr className="text-parchment-500 dark:text-cream-muted uppercase tracking-wider">
          <th className="text-left px-3 py-1.5 font-medium">Source</th>
          <th className="text-left px-3 py-1.5 font-medium">Translation</th>
          <th className="text-left px-3 py-1.5 font-medium">Sanskrit</th>
          <th className="text-left px-3 py-1.5 font-medium">Category</th>
          <th className="text-left px-3 py-1.5 font-medium">Notes</th>
        </tr>
      </thead>
      <tbody>
        {terms.map((term) => (
          <tr
            key={term.term_id}
            className="border-t border-parchment-200/50 dark:border-ink-700/30 hover:bg-parchment-100/50 dark:hover:bg-ink-800/50"
          >
            <td className={`px-3 py-1.5 ${sourceFontClass} text-ink-850 dark:text-cream font-medium`}>
              {term.source}
            </td>
            <td className="px-3 py-1.5 text-jade dark:text-jade-light font-medium">
              {term.translation || (
                <button
                  onClick={() => onAddTerm?.(term.source)}
                  className="text-parchment-300 dark:text-ink-400 italic hover:text-gold transition-colors"
                >
                  + add translation
                </button>
              )}
              {term.do_not_translate && (
                <span className="ml-1 text-[10px] text-amber-600 dark:text-amber-400">DNT</span>
              )}
              {term.transliterate && (
                <span className="ml-1 text-[10px] text-amber-600 dark:text-amber-400">TL</span>
              )}
            </td>
            <td className="px-3 py-1.5 text-parchment-500 dark:text-cream-muted italic">
              {term.sanskrit || '—'}
            </td>
            <td className="px-3 py-1.5 text-parchment-500 dark:text-cream-muted capitalize">
              {term.category?.replace(/_/g, ' ') || '—'}
            </td>
            <td className="px-3 py-1.5 text-parchment-400 dark:text-cream-muted/60 max-w-[200px] truncate">
              {term.tbs_notes || term.context_notes || '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}


function QATab({ issues, sourceFontClass = 'font-chinese' }: { issues: QAIssue[]; sourceFontClass?: string }) {
  const missing = issues.filter((i) => !i.found)
  const passed = issues.filter((i) => i.found)

  if (issues.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-parchment-400 dark:text-cream-muted/60 font-body">
        Save a translation to run glossary QA checks
      </div>
    )
  }

  return (
    <div className="p-3 space-y-2">
      {missing.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-semibold text-amber-700 dark:text-status-warning font-body uppercase tracking-wider">
            Missing ({missing.length})
          </div>
          {missing.map((issue) => (
            <div
              key={issue.term_id}
              className="flex items-center gap-2 py-1.5 px-2 rounded bg-amber-50/50 dark:bg-status-warning-bg/30 text-xs"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500 dark:text-status-warning shrink-0" />
              <span className={`${sourceFontClass} text-ink-850 dark:text-cream`}>{issue.source_term}</span>
              <span className="text-parchment-400 dark:text-cream-muted/50">→</span>
              <span className="font-body font-medium text-jade dark:text-jade-light">{issue.expected_translation}</span>
              <span className="text-parchment-400 dark:text-cream-muted/50 font-body ml-auto">not found in translation</span>
            </div>
          ))}
        </div>
      )}

      {passed.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-semibold text-jade dark:text-jade-light font-body uppercase tracking-wider">
            Passed ({passed.length})
          </div>
          {passed.map((issue) => (
            <div
              key={issue.term_id}
              className="flex items-center gap-2 py-1 px-2 text-xs text-parchment-400 dark:text-cream-muted/60"
            >
              <span className="w-3.5 h-3.5 shrink-0 text-center text-jade">✓</span>
              <span className={sourceFontClass}>{issue.source_term}</span>
              <span>→</span>
              <span className="font-body">{issue.expected_translation}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
