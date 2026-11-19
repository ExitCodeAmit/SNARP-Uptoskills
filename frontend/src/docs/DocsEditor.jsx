import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Extension, Mark, mergeAttributes } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import { Placeholder } from '@tiptap/extensions'
import {
  HocuspocusProviderWebsocketComponent, HocuspocusRoom, useHocuspocusAwareness, useHocuspocusConnectionStatus,
  useHocuspocusEvent, useHocuspocusProvider, useHocuspocusSyncStatus,
} from '@hocuspocus/provider-react'
import {
  ArrowClockwise, ArrowCounterClockwise, ArrowLeft, Check, Code, Eye, FilePdf, FileText,
  ListBullets, ListNumbers, MagnifyingGlass, Minus, NotePencil, PencilSimple, Quotes, ShareNetwork, SignOut,
  TextAlignCenter, TextAlignJustify, TextAlignLeft, TextAlignRight, TextB, TextHOne, TextHTwo, TextItalic,
  TextStrikethrough, TextT, Trash, UserPlus, X,
} from '@phosphor-icons/react'
import { api } from '../api'
import { Avatar } from '../components/ui'
import { Overlay } from '../components/Overlay'
import CardMenu from '../components/CardMenu'
import ConfirmDialog from '../components/ConfirmDialog'
import { DocDetailsDialog } from './DocsHome'

const COLORS = ['#2f7df6', '#d1437e', '#12a38a', '#d9822b', '#7a5af5', '#1c93b8', '#c2410c', '#4f7d1f']
const colorForUser = (id) => {
  let sum = 0
  for (const char of String(id)) sum = (sum * 31 + char.charCodeAt(0)) >>> 0
  return COLORS[sum % COLORS.length]
}
const PRESENCE_IDLE = 60_000
const PRESENCE_REFRESH = 15_000
const ACCESS = { owner: 'Owner', editor: 'Can edit', viewer: 'Can view' }
const FONTS = [
  { group: 'Sans serif', label: 'Inter', value: 'Inter, sans-serif' },
  { group: 'Sans serif', label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { group: 'Sans serif', label: 'Calibri', value: 'Calibri, Arial, sans-serif' },
  { group: 'Sans serif', label: 'Segoe UI', value: '"Segoe UI", Arial, sans-serif' },
  { group: 'Sans serif', label: 'Verdana', value: 'Verdana, sans-serif' },
  { group: 'Serif', label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { group: 'Serif', label: 'Cambria', value: 'Cambria, Georgia, serif' },
  { group: 'Serif', label: 'Georgia', value: 'Georgia, serif' },
  { group: 'Serif', label: 'Garamond', value: 'Garamond, "Times New Roman", serif' },
  { group: 'Monospace', label: 'Courier New', value: '"Courier New", monospace' },
  { group: 'Monospace', label: 'Consolas', value: 'Consolas, "Courier New", monospace' },
]
const FONT_GROUPS = ['Sans serif', 'Serif', 'Monospace']
const SIZE_PRESETS = [9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32]
const DEFAULT_FONT = '"Times New Roman", Times, serif'
const DEFAULT_SIZE = '12pt'

const cleanFont = (value) => {
  const normalize = (font) => String(font || '').toLowerCase().replace(/['"]/g, '').replace(/\s+/g, ' ').trim()
  return FONTS.find((option) => normalize(option.value) === normalize(value))?.value ?? null
}
const cleanSize = (value) => {
  const size = String(value || '').trim().toLowerCase()
  if (!/^\d{1,2}(?:\.\d{1,2})?pt$/.test(size)) return null
  const points = Number.parseFloat(size)
  return points >= 8 && points <= 72 ? `${Number(points.toFixed(2))}pt` : null
}

// Font family and size, only from the allowed lists (so pasted HTML cannot inject styles).
const TextStyle = Mark.create({
  name: 'textStyle',
  priority: 101,
  addAttributes() {
    return {
      fontFamily: { default: null, parseHTML: (el) => cleanFont(el.style.fontFamily), renderHTML: () => ({}) },
      fontSize: { default: null, parseHTML: (el) => cleanSize(el.style.fontSize), renderHTML: () => ({}) },
    }
  },
  parseHTML() {
    return [{ tag: 'span[style]', getAttrs: (el) => { const fontFamily = cleanFont(el.style.fontFamily); const fontSize = cleanSize(el.style.fontSize); return fontFamily || fontSize ? { fontFamily, fontSize } : false } }]
  },
  renderHTML({ mark, HTMLAttributes }) {
    const styles = []
    if (cleanFont(mark.attrs.fontFamily)) styles.push(`font-family: ${cleanFont(mark.attrs.fontFamily)}`)
    if (cleanSize(mark.attrs.fontSize)) styles.push(`font-size: ${cleanSize(mark.attrs.fontSize)}`)
    return ['span', mergeAttributes(HTMLAttributes, styles.length ? { style: styles.join('; ') } : {}), 0]
  },
})

const TextAlign = Extension.create({
  name: 'paragraphAlignment',
  addGlobalAttributes() {
    return [{
      types: ['paragraph', 'heading'],
      attributes: {
        textAlign: {
          default: 'left',
          parseHTML: (el) => (['left', 'center', 'right', 'justify'].includes(el.style.textAlign) ? el.style.textAlign : 'left'),
          renderHTML: (attrs) => (attrs.textAlign && attrs.textAlign !== 'left' ? { style: `text-align: ${attrs.textAlign}` } : {}),
        },
      },
    }]
  },
})

// Marks typed or pasted text with who wrote it; hovering shows "Added by <name>".
function authorMark(user) {
  const author = { authorId: String(user.id), authorName: user.name || 'SNARP member' }
  return Mark.create({
    name: 'changeAuthor',
    inclusive: false,
    addAttributes() {
      return {
        authorId: { default: null, parseHTML: (el) => el.getAttribute('data-doc-author-id'), renderHTML: (a) => (a.authorId ? { 'data-doc-author-id': a.authorId } : {}) },
        authorName: { default: null, parseHTML: (el) => el.getAttribute('data-doc-author-name'), renderHTML: (a) => (a.authorName ? { 'data-doc-author-name': a.authorName } : {}) },
      }
    },
    parseHTML() { return [{ tag: 'span[data-doc-author-id]' }] },
    renderHTML({ HTMLAttributes }) {
      return ['span', mergeAttributes(HTMLAttributes, { class: 'docs-authored', 'data-author-name': HTMLAttributes['data-doc-author-name'] || 'SNARP member' }), 0]
    },
    addProseMirrorPlugins() {
      return [new Plugin({
        props: {
          handleTextInput(view, from, to, text) {
            if (!view.editable || !text || view.composing) return false
            const tr = view.state.tr.insertText(text, from, to)
            tr.addMark(from, from + text.length, view.state.schema.marks.changeAuthor.create(author))
            view.dispatch(tr)
            return true
          },
          handlePaste(view, _event, slice) {
            if (!view.editable || slice.content.size === 0) return false
            const from = view.state.selection.from
            const tr = view.state.tr.replaceSelection(slice)
            const to = tr.selection.from
            if (to > from) tr.addMark(from, to, view.state.schema.marks.changeAuthor.create(author))
            view.dispatch(tr)
            return true
          },
        },
      })]
    },
  })
}

function caretExtension(provider, user) {
  return CollaborationCaret.configure({
    provider,
    user: { id: String(user.id), name: user.name, color: colorForUser(user.id) },
    render: (person) => {
      const caret = document.createElement('span')
      caret.className = 'docs-caret'
      caret.style.borderColor = person.color
      const label = document.createElement('span')
      label.className = 'docs-caret-label'
      label.style.backgroundColor = person.color
      label.append(document.createTextNode(person.name || 'Collaborator'))
      caret.append(label)
      return caret
    },
    selectionRender: (person) => ({ class: 'docs-selection', style: `background-color: ${person.color}33` }),
  })
}

function FontSize({ editor, value }) {
  const saved = Number.parseFloat(value) || 12
  const [draft, setDraft] = useState(String(saved))
  const apply = () => {
    const points = Number(draft)
    if (!Number.isFinite(points) || points < 8 || points > 72) return setDraft(String(saved))
    const size = Number(points.toFixed(1))
    setDraft(String(size))
    editor.chain().focus().setMark('textStyle', { fontSize: `${size}pt` }).run()
  }
  return (
    <>
      <input className="docs-size" type="number" min="8" max="72" step="0.5" list="docs-size-presets" aria-label="Font size in points" title="Font size"
        value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={apply}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); apply() } }} />
      <datalist id="docs-size-presets">{SIZE_PRESETS.map((size) => <option key={size} value={size} />)}</datalist>
    </>
  )
}

function Toolbar({ editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e?.isActive('bold'), italic: e?.isActive('italic'), strike: e?.isActive('strike'), code: e?.isActive('code'),
      paragraph: e?.isActive('paragraph'), h1: e?.isActive('heading', { level: 1 }), h2: e?.isActive('heading', { level: 2 }),
      bullet: e?.isActive('bulletList'), ordered: e?.isActive('orderedList'), quote: e?.isActive('blockquote'),
      font: e?.getAttributes('textStyle').fontFamily || DEFAULT_FONT,
      size: e?.getAttributes('textStyle').fontSize || DEFAULT_SIZE,
      align: (e?.isActive('heading') ? e.getAttributes('heading').textAlign : e?.getAttributes('paragraph').textAlign) || 'left',
      canUndo: e?.can().undo(), canRedo: e?.can().redo(),
    }),
  })
  if (!editor) return null
  const run = (fn) => () => fn(editor.chain().focus()).run()
  const align = (value) => () => editor.chain().focus().updateAttributes(editor.isActive('heading') ? 'heading' : 'paragraph', { textAlign: value }).run()
  const tool = (label, Icon, active, onClick, disabled = false) => (
    <button key={label} type="button" className={`docs-tool ${active ? 'on' : ''}`} onClick={onClick} disabled={disabled}
      aria-label={label} title={label} aria-pressed={active == null ? undefined : !!active}>
      <Icon size={18} weight={active ? 'bold' : 'regular'} />
    </button>
  )
  return (
    <div className="docs-toolbar docs-print-hidden" role="toolbar" aria-label="Formatting">
      <div className="docs-tool-group">
        {tool('Undo', ArrowCounterClockwise, null, run((c) => c.undo()), !state.canUndo)}
        {tool('Redo', ArrowClockwise, null, run((c) => c.redo()), !state.canRedo)}
      </div>
      <div className="docs-tool-group">
        {tool('Normal text', TextT, state.paragraph, run((c) => c.setParagraph()))}
        {tool('Heading 1', TextHOne, state.h1, run((c) => c.toggleHeading({ level: 1 })))}
        {tool('Heading 2', TextHTwo, state.h2, run((c) => c.toggleHeading({ level: 2 })))}
      </div>
      <div className="docs-tool-group">
        <select className="docs-font" aria-label="Font" title="Font" value={state.font} onChange={(event) => editor.chain().focus().setMark('textStyle', { fontFamily: event.target.value }).run()}>
          {FONT_GROUPS.map((group) => (
            <optgroup key={group} label={group}>{FONTS.filter((font) => font.group === group).map((font) => <option key={font.value} value={font.value}>{font.label}</option>)}</optgroup>
          ))}
        </select>
        <FontSize key={state.size} editor={editor} value={state.size} />
      </div>
      <div className="docs-tool-group">
        {tool('Bold', TextB, state.bold, run((c) => c.toggleBold()))}
        {tool('Italic', TextItalic, state.italic, run((c) => c.toggleItalic()))}
        {tool('Strikethrough', TextStrikethrough, state.strike, run((c) => c.toggleStrike()))}
        {tool('Inline code', Code, state.code, run((c) => c.toggleCode()))}
      </div>
      <div className="docs-tool-group">
        {tool('Align left', TextAlignLeft, state.align === 'left', align('left'))}
        {tool('Align center', TextAlignCenter, state.align === 'center', align('center'))}
        {tool('Align right', TextAlignRight, state.align === 'right', align('right'))}
        {tool('Justify', TextAlignJustify, state.align === 'justify', align('justify'))}
      </div>
      <div className="docs-tool-group">
        {tool('Bulleted list', ListBullets, state.bullet, run((c) => c.toggleBulletList()))}
        {tool('Numbered list', ListNumbers, state.ordered, run((c) => c.toggleOrderedList()))}
        {tool('Quote', Quotes, state.quote, run((c) => c.toggleBlockquote()))}
        {tool('Divider line', Minus, null, run((c) => c.setHorizontalRule()))}
      </div>
    </div>
  )
}

function ShareDialog({ doc, viewer, onClose, onLeave }) {
  const [access, setAccess] = useState(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [friends, setFriends] = useState(null)
  const [permission, setPermission] = useState('editor')
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const owner = doc.permission === 'owner'
  const canInvite = doc.permission !== 'viewer'

  const load = useCallback(() => api(`/docs/${doc.id}/members`).then(setAccess).catch((err) => setError(err.message)), [doc.id])
  useEffect(() => { load() }, [load])

  // Friends (people you follow who follow you back) are offered first, so they can be added in one click.
  useEffect(() => {
    if (!canInvite) return undefined
    let active = true
    api('/users/friends').then((list) => { if (active) setFriends(list) }).catch(() => { if (active) setFriends([]) })
    return () => { active = false }
  }, [canInvite])

  useEffect(() => {
    const q = query.trim()
    if (!canInvite || !q) return undefined
    let active = true
    const timer = setTimeout(() => {
      api(`/users/search?q=${encodeURIComponent(q)}`)
        .then((list) => { if (active) setResults(list.map((p) => ({ ...p, avatar_url: p.profile_image_id ? `/api/images/${p.profile_image_id}` : null }))) })
        .catch(() => { if (active) setResults([]) })
    }, 200)
    return () => { active = false; clearTimeout(timer) }
  }, [query, canInvite])

  const act = async (key, fn, message) => {
    setBusy(key)
    setError('')
    setNotice('')
    try {
      await fn()
      if (message) setNotice(message)
      await load()
    } catch (err) { setError(err.message) } finally { setBusy('') }
  }

  const invite = (person) => act(`invite-${person.id}`, () => api(`/docs/${doc.id}/invitations`, { method: 'POST', body: { userId: person.id, permission } }),
    `Invitation sent to ${person.name} (${ACCESS[permission].toLowerCase()}). They can start once they accept.`)

  const status = new Map([
    [String(access?.owner?.id), 'Owner'],
    ...(access?.members ?? []).map((m) => [String(m.user_id), 'Has access']),
    ...(access?.pending ?? []).map((p) => [String(p.user_id), 'Invited']),
    [String(viewer.id), 'You'],
  ])
  const searching = !!query.trim()
  const candidates = searching ? results.slice(0, 8) : (friends ?? [])
  const people = access ? 1 + access.members.length : 0

  return (
    <Overlay className="docs-dialog docs-share" labelledBy="docs-share-title" onClose={onClose}>
      <header className="docs-dialog-head">
        <h2 id="docs-share-title"><ShareNetwork size={20} /> {canInvite ? 'Share document' : 'People with access'}</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
      </header>
      <div className="docs-dialog-body">
        {canInvite && (
          <>
            <div className="docs-invite-row">
              <label className="docs-search docs-invite-search">
                <MagnifyingGlass size={17} />
                <span className="sr-only">Find people to invite</span>
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search anyone on SNARP by name" maxLength={80} autoFocus />
                {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search"><X size={15} /></button>}
              </label>
              <div className="docs-perm-toggle" role="radiogroup" aria-label="Access for new invitations">
                <button type="button" role="radio" aria-checked={permission === 'editor'} className={permission === 'editor' ? 'on' : ''} onClick={() => setPermission('editor')}><PencilSimple size={14} /> Can edit</button>
                <button type="button" role="radio" aria-checked={permission === 'viewer'} className={permission === 'viewer' ? 'on' : ''} onClick={() => setPermission('viewer')}><Eye size={14} /> Can view</button>
              </div>
            </div>
            <h3 className="docs-people-title">{searching ? 'Search results' : 'Your friends'}</h3>
            <ul className="docs-people docs-results">
              {!searching && friends === null && <li className="docs-people-empty">Loading your friends…</li>}
              {candidates.length === 0 && (searching || friends !== null) && (
                <li className="docs-people-empty">{searching ? 'No one found with that name.' : 'No friends yet. Friends are people you follow who follow you back. Search above to invite anyone.'}</li>
              )}
              {candidates.map((person) => {
                const state = status.get(String(person.id))
                return (
                  <li key={person.id}>
                    <Avatar name={person.name} src={person.avatar_url} size="sm" />
                    <span className="docs-person"><strong>{person.name}</strong><small>{person.institution || person.department || (searching ? 'SNARP member' : 'Friend')}</small></span>
                    {state
                      ? <span className="docs-person-note">{state}</span>
                      : <button type="button" className="btn btn-primary btn-sm" onClick={() => invite(person)} disabled={!!busy}><UserPlus size={15} /> {busy === `invite-${person.id}` ? 'Inviting…' : 'Invite'}</button>}
                  </li>
                )
              })}
            </ul>
            <p className="docs-help">They get a notification and an invitation in Docs, and join once they accept.{owner ? '' : ' As an editor you can invite people; the owner manages access.'}</p>
          </>
        )}
        {notice && <p className="docs-notice" role="status"><Check size={16} weight="bold" /> {notice}</p>}
        {error && <p className="field-error" role="alert">{error}</p>}

        <h3 className="docs-people-title">People with access {access && <span>{people}</span>}</h3>
        {!access ? <p className="docs-help">Loading…</p> : (
          <ul className="docs-people">
            <li>
              <Avatar name={access.owner.name} src={access.owner.avatar_url} size="sm" />
              <span className="docs-person"><strong>{access.owner.name}{String(access.owner.id) === String(viewer.id) ? ' (you)' : ''}</strong><small>Owner</small></span>
            </li>
            {access.members.map((member) => (
              <li key={member.user_id}>
                <Avatar name={member.name} src={member.avatar_url} size="sm" />
                <span className="docs-person"><strong>{member.name}{String(member.user_id) === String(viewer.id) ? ' (you)' : ''}</strong><small>{ACCESS[member.permission]}</small></span>
                {owner && (
                  <>
                    <select className="docs-perm-select" aria-label={`Access for ${member.name}`} value={member.permission} disabled={!!busy}
                      onChange={(event) => act(`perm-${member.user_id}`, () => api(`/docs/${doc.id}/members/${member.user_id}`, { method: 'PATCH', body: { permission: event.target.value } }))}>
                      <option value="editor">Can edit</option>
                      <option value="viewer">Can view</option>
                    </select>
                    <button type="button" className="icon-btn" title={`Remove ${member.name}`} aria-label={`Remove ${member.name}`} disabled={!!busy}
                      onClick={() => act(`remove-${member.user_id}`, () => api(`/docs/${doc.id}/members/${member.user_id}`, { method: 'DELETE' }), `${member.name} no longer has access.`)}>
                      <Trash size={16} />
                    </button>
                  </>
                )}
              </li>
            ))}
            {access.pending.map((invite) => (
              <li key={invite.id} className="docs-pending">
                <Avatar name={invite.name} src={invite.avatar_url} size="sm" />
                <span className="docs-person">
                  <strong>{invite.name}</strong>
                  <small>Invited · {ACCESS[invite.permission]}{String(invite.inviter_id) !== String(access.owner.id) ? ` · by ${invite.inviter_name}` : ''} · waiting for reply</small>
                </span>
                {(owner || String(invite.inviter_id) === String(viewer.id)) && (
                  <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy}
                    onClick={() => act(`cancel-${invite.id}`, () => api(`/docs/${doc.id}/invitations/${invite.id}`, { method: 'DELETE' }), 'Invitation cancelled.')}>Cancel</button>
                )}
              </li>
            ))}
            {access.members.length === 0 && access.pending.length === 0 && <li className="docs-people-empty">{owner ? 'Only you have access so far.' : 'No one else yet.'}</li>}
          </ul>
        )}
        {!owner && <button type="button" className="btn btn-ghost docs-leave" onClick={onLeave}><SignOut size={16} /> Leave document</button>}
      </div>
    </Overlay>
  )
}

function Room({ doc, user, onDocChange, onReset }) {
  const navigate = useNavigate()
  const provider = useHocuspocusProvider()
  const status = useHocuspocusConnectionStatus()
  const sync = useHocuspocusSyncStatus()
  const awareness = useHocuspocusAwareness()
  const [savedAt, setSavedAt] = useState('')
  const [team, setTeam] = useState(null)
  const [activeIds, setActiveIds] = useState(() => new Set())
  const [dialog, setDialog] = useState(null)
  const lastPing = useRef(0)
  const connected = status === 'connected'
  const canEdit = doc.permission !== 'viewer'

  // Someone new joined the room (e.g. just accepted an invitation): refresh the team list.
  const knownIds = new Set(team ? [String(team.owner.id), ...team.members.map((m) => String(m.user_id))] : [])
  const newcomers = connected && team ? awareness.map((p) => String(p.user?.id ?? '')).filter((id) => id && !knownIds.has(id)).sort().join() : ''

  useEffect(() => {
    let active = true
    const load = () => api(`/docs/${doc.id}/members`).then((result) => { if (active) setTeam(result) }).catch(() => {})
    load()
    const timer = setInterval(load, 30000)
    return () => { active = false; clearInterval(timer) }
  }, [doc.id, dialog, newcomers])

  // When the owner changes someone's access, the server resets this document's connection.
  // Re-check access and reconnect with a fresh ticket (or show that access is gone).
  useHocuspocusEvent('close', useCallback(({ event }) => {
    if (event?.reason === 'Reset Connection') onReset()
  }, [onReset]))
  useHocuspocusEvent('authenticationFailed', useCallback(() => onReset(), [onReset]))


  // "Working now" = typed, clicked or scrolled in the last minute.
  useEffect(() => {
    if (!connected || !provider.awareness) return undefined
    const ping = () => {
      const now = Date.now()
      if (now - lastPing.current < PRESENCE_REFRESH) return
      lastPing.current = now
      provider.awareness.setLocalStateField('lastActiveAt', now)
    }
    ping()
    const events = ['pointerdown', 'keydown', 'input', 'scroll', 'touchstart']
    events.forEach((name) => window.addEventListener(name, ping, { passive: true }))
    return () => events.forEach((name) => window.removeEventListener(name, ping))
  }, [connected, provider])

  useEffect(() => {
    const refresh = () => {
      const now = Date.now()
      const next = new Set(awareness.filter((p) => Number.isFinite(p.lastActiveAt) && now - p.lastActiveAt < PRESENCE_IDLE).map((p) => String(p.user?.id)))
      setActiveIds((current) => (current.size === next.size && [...current].every((id) => next.has(id)) ? current : next))
    }
    refresh()
    const timer = setInterval(refresh, 5000)
    return () => clearInterval(timer)
  }, [awareness])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      TextAlign,
      Placeholder.configure({ placeholder: canEdit ? 'Start writing your research here…' : 'This document is empty.' }),
      TextStyle,
      authorMark(user),
      Collaboration.configure({ document: provider.document }),
      caretExtension(provider, user),
    ],
    editable: canEdit,
    editorProps: { attributes: { 'aria-label': `Document: ${doc.title}`, spellcheck: 'true' } },
  }, [provider, doc.id])

  useEffect(() => { editor?.setEditable(canEdit) }, [editor, canEdit])

  useHocuspocusEvent('stateless', useCallback(({ payload }) => {
    try { const data = JSON.parse(payload); if (data.type === 'document-saved') setSavedAt(data.savedAt) } catch { /* other messages */ }
  }, []))

  const online = new Set(connected ? awareness.map((p) => String(p.user?.id)).filter(Boolean) : [])
  const people = team
    ? [{ id: team.owner.id, name: team.owner.name, avatar_url: team.owner.avatar_url, permission: 'owner' }, ...team.members.map((m) => ({ id: m.user_id, name: m.name, avatar_url: m.avatar_url, permission: m.permission }))]
    : [{ id: user.id, name: user.name, avatar_url: user.avatar_url, permission: doc.permission }]
  const presence = people.map((person) => {
    const id = String(person.id)
    const me = id === String(user.id)
    return { ...person, me, online: me ? connected : online.has(id), active: activeIds.has(id) }
  }).sort((a, b) => Number(b.me) - Number(a.me) || Number(b.active) - Number(a.active) || Number(b.online) - Number(a.online))
  const onlineCount = presence.filter((p) => p.online).length

  const statusText = !connected ? (status === 'connecting' ? 'Connecting…' : 'Offline · reconnecting')
    : sync === 'syncing' ? 'Saving…'
      : savedAt ? `Saved ${new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(savedAt))}`
        : 'All changes saved'

  const leaveOrDelete = async () => {
    if (doc.permission === 'owner') await api(`/docs/${doc.id}`, { method: 'DELETE' })
    else await api(`/docs/${doc.id}/members/${user.id}`, { method: 'DELETE' })
    navigate('/docs')
  }

  return (
    <div className="page docs-editor">
      <header className="docs-editor-head docs-print-hidden">
        <Link to="/docs" className="docs-back"><ArrowLeft size={16} /> Docs</Link>
        <div className="docs-title-row">
          <span className="docs-title-icon" aria-hidden="true"><FileText size={22} weight="duotone" /></span>
          <div className="docs-title-copy">
            <h1>{doc.title}</h1>
            <p>
              <span className={`docs-badge docs-badge-${doc.permission}`}>{doc.permission === 'viewer' ? 'View only' : ACCESS[doc.permission]}</span>
              {doc.permission !== 'owner' && <span>Owner: {doc.owner_name}</span>}
              <span className={`docs-status ${connected ? (sync === 'syncing' ? 'saving' : 'ok') : 'off'}`} role="status" aria-live="polite"><i aria-hidden="true" /> {statusText}</span>
            </p>
          </div>
          <div className="docs-team" aria-label={`${onlineCount} of ${presence.length} people online`}>
            {presence.slice(0, 5).map((person) => (
              <span key={person.id} className={`docs-team-person ${person.active ? 'active' : person.online ? 'online' : 'offline'}`}
                style={{ '--ring': colorForUser(person.id) }}
                title={`${person.name}${person.me ? ' (you)' : ''}: ${person.active ? 'working now' : person.online ? 'online' : 'offline'} · ${ACCESS[person.permission]}`}>
                <Avatar name={person.name} src={person.avatar_url} size="sm" />
                <i aria-hidden="true" />
              </span>
            ))}
            {presence.length > 5 && <span className="docs-team-more">+{presence.length - 5}</span>}
          </div>
          <button type="button" className="btn btn-primary docs-share-btn" onClick={() => setDialog('share')}>
            <ShareNetwork size={17} /> <span>{doc.permission === 'viewer' ? 'People' : 'Share'}</span>
          </button>
          <CardMenu label="Document options" items={[
            ...(doc.permission === 'owner' ? [{ label: 'Rename / describe', icon: NotePencil, onClick: () => setDialog('details') }] : []),
            { label: 'Save as PDF', icon: FilePdf, onClick: () => window.print() },
            doc.permission === 'owner'
              ? { label: 'Delete document', icon: Trash, danger: true, onClick: () => setDialog('delete') }
              : { label: 'Leave document', icon: SignOut, danger: true, onClick: () => setDialog('delete') },
          ]} />
        </div>
        {doc.description && <p className="docs-description">{doc.description}</p>}
      </header>

      {canEdit ? <Toolbar editor={editor} /> : <p className="docs-readonly docs-print-hidden"><Eye size={16} /> You can read this document but not change it. Ask the owner for edit access.</p>}

      <section className="docs-paper-wrap" aria-label="Document"
        onMouseDown={(event) => {
          if (event.target !== event.currentTarget || !editor?.isEditable) return
          event.preventDefault()
          editor.commands.focus('end')
        }}>
        <article className="docs-paper">
          <h1 className="docs-print-title">{doc.title}</h1>
          <EditorContent editor={editor} />
        </article>
      </section>

      {dialog === 'share' && <ShareDialog doc={doc} viewer={user} onClose={() => setDialog(null)} onLeave={() => setDialog('delete')} />}
      {dialog === 'details' && <DocDetailsDialog doc={doc} onClose={() => setDialog(null)} onSaved={(next) => { onDocChange((current) => ({ ...current, ...next })); setDialog(null) }} />}
      {dialog === 'delete' && (
        <ConfirmDialog
          title={doc.permission === 'owner' ? 'Delete this document?' : 'Leave this document?'}
          message={doc.permission === 'owner' ? `"${doc.title}" and everything written in it will be permanently deleted for everyone.` : `You will lose access to "${doc.title}". The owner can invite you again.`}
          confirmText={doc.permission === 'owner' ? 'Delete document' : 'Leave'}
          onCancel={() => setDialog(null)}
          onConfirm={leaveOrDelete}
        />
      )}
    </div>
  )
}

function Loader({ documentId, user }) {
  const [doc, setDoc] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    api(`/docs/${documentId}`).then((result) => { if (active) setDoc(result) }).catch((err) => { if (active) setError(err.message) })
    return () => { active = false }
  }, [documentId])

  const [session, setSession] = useState(0)
  const [lost, setLost] = useState(false)
  const resetting = useRef(false)

  const ticket = useCallback(async () => {
    const result = await api(`/docs/${documentId}/ws-ticket`, { method: 'POST' })
    setDoc((current) => (current && current.permission !== result.permission ? { ...current, permission: result.permission } : current))
    return result.token
  }, [documentId])

  // The live connection was reset (access changed) or refused: ask the API what access is left,
  // then reconnect with a fresh room, or show that the document is no longer available.
  const onReset = useCallback(async () => {
    if (resetting.current) return
    resetting.current = true
    try {
      const fresh = await api(`/docs/${documentId}`)
      setDoc(fresh)
      setSession((n) => n + 1)
    } catch (err) {
      if (err.status === 404 || err.status === 403) setLost(true)
      else setTimeout(() => setSession((n) => n + 1), 3000)
    } finally {
      setTimeout(() => { resetting.current = false }, 1000)
    }
  }, [documentId])

  if (error || lost) {
    return (
      <div className="page"><div className="panel empty docs-empty" role="alert">
        <span className="docs-empty-icon"><FileText size={30} weight="duotone" /></span>
        <h3>{lost ? 'You no longer have access' : 'Document unavailable'}</h3>
        <p>{lost ? 'The owner removed your access or deleted this document.' : error === 'Document not found' ? 'It was deleted, or you do not have access to it.' : error}</p>
        <Link className="btn btn-primary" to="/docs">Back to Docs</Link>
      </div></div>
    )
  }
  if (!doc) return <div className="page"><div className="panel empty" aria-busy="true">Opening document…</div></div>
  const url = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/collaboration`
  return (
    // A reset gets a brand-new socket: the server forgets a reset document on the old one.
    <HocuspocusProviderWebsocketComponent key={session} url={url}>
      <HocuspocusRoom key={`${doc.id}-${session}`} name={doc.id} token={ticket}>
        <Room doc={doc} user={user} onDocChange={setDoc} onReset={onReset} />
      </HocuspocusRoom>
    </HocuspocusProviderWebsocketComponent>
  )
}

export default function DocsEditor({ user }) {
  const { documentId } = useParams()
  return <Loader key={documentId} documentId={documentId} user={user} />
}

