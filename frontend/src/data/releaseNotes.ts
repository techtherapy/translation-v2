export interface ReleaseNote {
  version: string
  date: string
  highlights: string[]
}

const releaseNotes: ReleaseNote[] = [
  {
    version: '0.21.7',
    date: '2026-04-07',
    highlights: [
      'Internal refactor — the translation display column (track changes diff, original view, plain text with comment highlights) is now a self-contained component, making the editor easier to maintain and extend',
    ],
  },
  {
    version: '0.21.6',
    date: '2026-04-07',
    highlights: [
      'Internal refactor — track changes comparison logic is now shared from a single source across all parts of the editor, ensuring consistent change detection everywhere',
    ],
  },
  {
    version: '0.21.5',
    date: '2026-04-07',
    highlights: [
      'Internal refactor — comment and annotation margin state (loading, toggling margins, creating and updating comments) is now isolated in a dedicated module, keeping the editor more maintainable',
    ],
  },
  {
    version: '0.21.4',
    date: '2026-04-07',
    highlights: [
      'Internal refactor — track changes logic (toggle, accept, reject, display mode) is now isolated in a dedicated module, making it easier to improve and maintain',
    ],
  },
  {
    version: '0.21.3',
    date: '2026-04-07',
    highlights: [
      'Performance improvement — editing one segment no longer causes other segments to re-render, making the editor faster with long chapters',
    ],
  },
  {
    version: '0.21.2',
    date: '2026-04-07',
    highlights: [
      'Internal improvements to comment highlighting — clicking a comment in the editor now uses a cleaner, more reliable approach',
    ],
  },
  {
    version: '0.21.1',
    date: '2026-04-07',
    highlights: [
      'Internal improvements to how track changes are computed — groundwork for more reliable accept/reject behavior',
    ],
  },
  {
    version: '0.21.0',
    date: '2026-04-06',
    highlights: [
      'Comments and track changes now appear in a margin alongside their segments — scroll-synced so annotations stay next to the text they refer to',
      'Toggle comments and changes independently using the toolbar icons',
      'No more side panel tab switching — see everything at a glance per segment',
      'Accept or reject track changes directly in the margin next to each segment',
    ],
  },
  {
    version: '0.20.1',
    date: '2026-04-05',
    highlights: [
      'Comment on selected text directly while editing — a popup appears when you select text, same as in read mode',
      'Click a quoted phrase in the comments panel to scroll to exactly where it appears in the translation',
      'Comment on text even when track changes markup is visible',
      'Cleaner comments panel layout — removed redundant tab bar in the side panel',
    ],
  },
  {
    version: '0.20.0',
    date: '2026-04-05',
    highlights: [
      'Select specific text in a translation and leave a comment on that exact phrase',
      'Comments and track changes are now combined in a unified Review panel with tabs',
      'React to comments with emoji (thumbs up, check mark, question mark, and more) for quick feedback',
      'Commented phrases are highlighted in the translation text — click to jump to the comment',
    ],
  },
  {
    version: '0.19.0',
    date: '2026-04-04',
    highlights: [
      'New track changes review panel — a dedicated side panel shows all changes in the chapter with per-hunk accept/reject controls',
      'Separate tracking toggle and display mode — turn tracking on/off independently from how changes are displayed',
      'Three display modes when tracking is on: All Markup (inline diffs), No Markup (clean view), and Original (baseline text)',
      'Undo support — reverse accepted or rejected changes with Ctrl+Z or the undo button in the review panel',
    ],
  },
  {
    version: '0.18.0',
    date: '2026-04-04',
    highlights: [
      'Any-to-any language translation — source texts are no longer limited to Chinese; translate between any language pair',
      'New source language selector when creating translations from pasted text or uploaded files',
      'All languages now appear in every dropdown — Chinese can be used as a target language too',
      'Per-language prompt instructions — add style guides, formality, dialect, or terminology preferences for each target language in Settings',
    ],
  },
  {
    version: '0.17.0',
    date: '2026-04-03',
    highlights: [
      'New segment granularity control — choose between sentence, paragraph, or full chapter/text segmentation when importing',
      'Re-segment existing chapters from the editor toolbar — change granularity at any time with existing translations preserved',
      'Visual paragraph separators in the editor show original paragraph boundaries when working with sentence-level segments',
    ],
  },
  {
    version: '0.16.2',
    date: '2026-04-01',
    highlights: [
      'Simplified library — removed the separate "Add New Source" modal; all new content goes through "New Translation"',
      'Source details — when creating a translation from pasted text or an uploaded file, expand "Details" to add book number, year, category, and era',
    ],
  },
  {
    version: '0.16.1',
    date: '2026-03-28',
    highlights: [
      'Confirmation dialogs now show clear titles and action buttons instead of plain browser pop-ups, making destructive actions like deleting terms, categories, or languages easier to review before confirming',
    ],
  },
  {
    version: '0.16.0',
    date: '2026-04-01',
    highlights: [
      'New one-step translation flow — paste text, upload a file, or pick an existing source and start translating in a single action',
      'Book or Article — when uploading a file, choose whether it\'s a book (multi-chapter) or article (single chapter)',
      'Remembers your language — the target language you used last is pre-selected next time',
    ],
  },
  {
    version: '0.15.2',
    date: '2026-03-31',
    highlights: [
      'Paste to create articles — paste Chinese text directly when creating an article, no need to import a file first',
      'Compact view — click the minimize icon in the toolbar to fit more segments on screen with tighter spacing, smaller text, and hidden decorations',
    ],
  },
  {
    version: '0.15.0',
    date: '2026-03-30',
    highlights: [
      'Segment comments — leave threaded comments on any segment for reviewers and translators to discuss',
      'Comment filter — quickly find segments with unresolved comments using the new Comments chip in the filter bar',
      'Track changes now persists across sessions — no more losing tracked changes when you close the browser',
      'Formatting toolbar — Bold, Italic, Undo, Redo, and word count now visible when editing a segment',
    ],
  },
  {
    version: '0.14.0',
    date: '2026-03-30',
    highlights: [
      'Customizable translation prompts — edit the system and user prompts sent to the AI from the new Prompts tab in Settings',
      'Cleaner editor toolbar — actions collapsed into dropdown menus, language and counts moved to the left',
    ],
  },
  {
    version: '0.13.0',
    date: '2026-03-28',
    highlights: [
      'Track Changes upgraded — three modes: Off, Markup (show inline diffs), and Clean (hide markup)',
      'Accept All / Reject All buttons to resolve all changes in a chapter at once',
      'Previous/Next navigation to jump between changed segments with change count',
      'Author-colored changes — each editor\'s changes shown in a distinct color',
      'Usernames shown on tracked changes',
    ],
  },
  {
    version: '0.12.0',
    date: '2026-03-27',
    highlights: [
      'Track Changes — character-level diff highlighting for reviewer edits',
      'Per-change accept/reject with Accept All / Reject All',
      'Version history with real diffs and author attribution',
    ],
  },
  {
    version: '0.11.0',
    date: '2026-03-24',
    highlights: [
      'Translation projects — each book now has separate translation instances per language pair (e.g. Chinese→English, English→Indonesian)',
      'New library layout — "Translations" tab shows all your translation projects at a glance with progress bars; "Source Books" tab for managing and importing source texts',
      'Create new translations — pick a book, source language, and target language to start a new translation project',
      'Dedicated translation detail page — see chapter progress for a specific language pair',
      'Fixed language pair in editor — no more accidental language switching; source and target are locked to what the translation project defines',
      'Translation instance settings — configure LLM model overrides and notes per translation project',
      'Auto-translated titles — when creating a new translation, the book title is automatically translated to the target language; editable anytime from the translation detail page',
    ],
  },
  {
    version: '0.10.0',
    date: '2026-03-23',
    highlights: [
      'Pivot translation — translate from one language into another (e.g. approved English into Spanish) instead of always from Chinese',
      'Source language selector — choose which language to translate from in the editor toolbar, with Chinese always available as reference',
      'Per-language progress dashboard — see translation status breakdown (empty, AI-translated, draft, review, approved) for each target language on the book detail page',
      'Pivot readiness indicators — see how many segments have approved translations ready for relay translation',
      'Languages with a reference language show their pivot readiness automatically in the progress view',
    ],
  },
  {
    version: '0.9.1',
    date: '2026-03-17',
    highlights: [
      'Improved keyboard navigation — arrow keys and Tab now highlight segments without entering edit mode, press Enter to start editing',
      'AI translate shortcut (Ctrl+Enter) now works on any highlighted segment, no need to enter edit mode first',
      'Escape now has a 3-step flow: exit editing, then deselect segment, then close panels',
    ],
  },
  {
    version: '0.9.0',
    date: '2026-03-14',
    highlights: [
      'Keyboard shortcuts — Ctrl+S to save, Ctrl+Enter to translate, Ctrl+↓/↑ to navigate segments, and more (press ? to see all shortcuts)',
      'Auto-save — translations now save automatically after 2 seconds of inactivity, with a subtle status indicator',
      'Single-click segment activation — no more double-clicking to start editing',
      'Segment status controls — change translation status (Draft, Review, Approved, Revision) right from the editor with dropdown or Ctrl+1-4',
      'Color-coded segments — each segment row shows a colored left border matching its translation status for quick visual scanning',
      'Version history — click the history icon on any active segment to see all previous versions and restore any of them',
      'Find and Replace — Ctrl+F to search across all segments, Ctrl+H to find and replace in translations',
      'Segment filtering — filter segments by status (Empty, MT, Draft, Review, Approved, Revision) with clickable chips',
      'Progress overview — see a compact progress bar and counts showing how many segments are in each status',
      'Word and character counts — Chinese character counts per segment and chapter, plus English word counts for translations',
      'Batch status update — select multiple segments with checkboxes and change their status or re-translate them all at once',
      'Unsaved changes warning — the browser warns you before leaving the page if you have unsaved edits',
    ],
  },
  {
    version: '0.8.0',
    date: '2026-03-14',
    highlights: [
      'New Bulk Import — upload multiple book files at once (supports .txt, .docx, and .zip)',
      'Book numbers are parsed from filenames automatically (e.g. "001 Title.txt" becomes Book #001)',
      'Titles can be auto-translated to English during import',
      'Review and edit all books before confirming the import — fix titles, numbers, or remove files',
      'Books now display their book number as a badge in the library',
      'New sort options in the library: by newest, by book number, or alphabetically',
    ],
  },
  {
    version: '0.7.1',
    date: '2026-03-12',
    highlights: [
      'Rebranded to BITS — Buddha Intelligence Translation System',
    ],
  },
  {
    version: '0.7.0',
    date: '2026-03-10',
    highlights: [
      'New Models tab in Settings — manage which AI models are available for translation',
      'Each model now shows its cost per million tokens so you can make informed choices',
      'Model costs are also visible in the model selector dropdown throughout the app',
      'Refresh the model catalog to pick up newly released models without restarting the server',
    ],
  },
  {
    version: '0.6.0',
    date: '2026-03-10',
    highlights: [
      'New A/B Model Comparison — compare translations from 2-4 AI models side by side and pick the best one',
      'Compare a single segment using the new compare button next to each translate button',
      'Compare an entire chapter at once with "Compare All" — review and pick winners for every segment',
      'Losing translations are saved in version history so you can always go back',
    ],
  },
  {
    version: '0.5.1',
    date: '2026-03-09',
    highlights: [
      'Source text is now split by sentences during import for cleaner, more manageable segments',
      'Chinese quoted speech (「…」) is automatically treated as a separate segment during import',
      'The manual split tool in the editor now also recognizes quoted speech boundaries',
    ],
  },
  {
    version: '0.5.0',
    date: '2026-03-06',
    highlights: [
      'Each language can now have a reference language — set it in Settings > Languages (e.g. set Spanish\'s reference to English)',
      'When a reference language is configured, a read-only column appears in the glossary showing the reference translations alongside your working translations',
      'The reference column appears automatically between the source term and your editable translation — no manual setup needed each session',
    ],
  },
  {
    version: '0.4.0',
    date: '2026-03-06',
    highlights: [
      'The glossary now supports multiple languages — use the language dropdown to switch between English, Indonesian, and any other configured language',
      'Glossary translations are saved per language, so switching languages shows only translations for that language',
      'Glossary terms can now have a custom source language — for example, use English as the source when translating to Spanish',
      'New Languages tab in Settings — admins can add, enable/disable, edit, or remove target languages',
      'Each language can have a custom prompt template override for AI translation',
    ],
  },
  {
    version: '0.3.0',
    date: '2026-02-20',
    highlights: [
      'Select text in either column to look it up in the glossary — works for both Chinese and English',
      'If a glossary match is found, click it to view and edit the entry directly from the editor',
      'If no match exists, you\'ll see "Add to Glossary" to create a new entry',
      'Glossary matches highlight the corresponding Chinese source term so you can see the connection across columns',
      'Double-click a segment to enter edit mode (previously single-click, which interfered with text selection)',
    ],
  },
  {
    version: '0.2.1',
    date: '2026-02-20',
    highlights: [
      'The "What\'s New" icon now pulses when there are unread release notes',
    ],
  },
  {
    version: '0.2.0',
    date: '2026-02-20',
    highlights: [
      'Added chapter progress bars — you can now see at a glance how much of each chapter has been translated',
      'Fixed "Translate All" timing out on large chapters — translations now save one-by-one and appear in real time while the batch is running',
      'You can now select text in the translation column and add it to the glossary — the Chinese source term is filled in automatically',
      'The glossary form now warns you if a term already exists before you create a duplicate',
      'Added this Release Notes panel so you can see what\'s new',
    ],
  },
  {
    version: '0.1.0',
    date: '2026-02-01',
    highlights: [
      'Initial release with side-by-side translation editor',
      'AI-powered translation using multiple LLM providers',
      'Glossary management with term detection and highlighting',
      'Translation Memory seeding with paragraph alignment',
      'Book and chapter management with file import',
    ],
  },
]

export const latestVersion = releaseNotes[0]?.version ?? '0.0.0'

export default releaseNotes
