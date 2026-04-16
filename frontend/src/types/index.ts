export interface User {
  id: number
  username: string
  email: string
  full_name: string
  role: 'admin' | 'translator' | 'reviewer'
  is_active: boolean
}

export interface PermissionItem {
  key: string
  label: string
}

export interface PermissionGroup {
  name: string
  permissions: PermissionItem[]
}

export interface RolePermissions {
  groups: PermissionGroup[]
  role_permissions: Record<string, string[]>
}

export interface Language {
  id: number
  code: string
  name: string
  is_enabled: boolean
  reference_language_id: number | null
  prompt_template_override: string | null
  created_at: string
}

export interface Book {
  id: number
  content_type: 'book' | 'article'
  book_number: number | null
  title_source: string
  title_translated: string
  year_published: number | null
  category: string
  era_tag: string | null
  series: string
  status: 'not_started' | 'in_progress' | 'under_review' | 'published'
  notes: string
  llm_model: string | null
  prompt_template: string | null
  source_language_id: number | null
  source_language_code: string | null
  source_language_name: string | null
  chapter_count: number
  segment_count: number
  created_at: string
  updated_at: string
}

export interface Chapter {
  id: number
  book_id: number
  title: string
  order: number
  segment_count: number
  translated_count: number
  status_counts?: Record<string, number> | null
  created_at: string
}

export interface Translation {
  id: number
  segment_id: number
  language_id: number
  source_language_id?: number | null
  translated_text: string
  status: 'empty' | 'machine_translated' | 'draft' | 'under_review' | 'approved' | 'needs_revision'
  llm_model_used: string | null
  token_count: number
  updated_by?: number | null
  updated_by_username?: string | null
  updated_at: string
  previous_text?: string | null
  content_format?: 'plain' | 'prosemirror'
}

export interface LanguageProgress {
  language_id: number
  language_code: string
  language_name: string
  counts: Record<string, number>
  total_translated: number
  percent_complete: number
}

export interface BookProgress {
  book_id: number
  total_segments: number
  languages: LanguageProgress[]
}

export interface PivotReadiness {
  total_segments: number
  approved_in_source: number
  percent_ready: number
}

export interface BookTranslation {
  id: number
  book_id: number
  source_language_id: number | null
  target_language_id: number
  status: 'not_started' | 'in_progress' | 'under_review' | 'completed'
  llm_model: string | null
  prompt_template: string | null
  translated_title: string
  track_changes: boolean
  notes: string
  created_at: string
  updated_at: string
  book_title_source: string
  book_title_translated: string
  book_number: number | null
  content_type: 'book' | 'article'
  source_language_code: string | null
  source_language_name: string | null
  target_language_code: string
  target_language_name: string
  total_segments: number
  translated_segments: number
  approved_segments: number
  percent_complete: number
}

export interface Segment {
  id: number
  chapter_id: number
  order: number
  paragraph_group: number
  source_text: string
  translations: Translation[]
  created_at: string
}

export interface ChapterDetail {
  id: number
  book_id: number
  title: string
  order: number
  segments: Segment[]
  created_at: string
}

export interface GlossaryTranslation {
  id: number
  term_id: number
  language_id: number
  translated_term: string
  is_preferred: boolean
  notes: string
}

export interface GlossaryTerm {
  id: number
  source_term: string
  source_language_id: number | null
  sanskrit_pali: string
  category: string
  tbs_notes: string
  context_notes: string
  do_not_translate: boolean
  transliterate: boolean
  project_tags: string
  source_reference: string
  tradition_group: string
  translations: GlossaryTranslation[]
  created_at: string
  updated_at: string
}

export interface GlossaryCategory {
  key: string
  label: string
  color: string
  sort_order: number
  is_builtin: boolean
}

export interface GlossaryProject {
  id: number
  name: string
  description: string
  is_active: boolean
  created_at: string
}

export interface TMEntry {
  id: number
  source_text: string
  translated_text: string
  language_id: number
  source_book_id: number | null
  alignment_confidence: number
  created_at: string
}

export interface TMMatch {
  tm_entry: TMEntry
  similarity: number
}

export interface AlignmentPair {
  source_text: string
  translated_text: string
  confidence: number
  source_index: number
  translation_index: number
  approved?: boolean
}

export interface QAIssue {
  term_id: number
  source_term: string
  expected_translation: string
  found: boolean
  do_not_translate: boolean
  transliterate: boolean
}

export interface ReactionUserInfo {
  id: number
  username: string
}

export interface ReactionSummary {
  emoji: string
  count: number
  users: ReactionUserInfo[]
  reacted_by_me: boolean
}

export interface SegmentComment {
  id: number
  segment_id: number
  language_id: number
  user_id: number
  username: string
  text: string
  quoted_text: string | null
  parent_id: number | null
  is_resolved: boolean
  resolved_by: number | null
  resolved_by_username: string | null
  resolved_at: string | null
  created_at: string
  updated_at: string
  replies: SegmentComment[]
  reactions: ReactionSummary[]
}

export interface ChapterCommentsData {
  comments: SegmentComment[]
  segment_comment_counts: Record<string, number>
  unresolved_count: number
}
