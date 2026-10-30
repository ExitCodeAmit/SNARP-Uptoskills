import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  BookmarkSimple, Check, DotsThree, FilePdf, Folder, FolderOpen,
  MagnifyingGlass, PencilSimple, Plus, Trash, X, ArrowRight,
} from '@phosphor-icons/react'
import { api, apiBlob } from './api'
import { Avatar, PageHeader } from './components/ui'
import { timeAgo } from './format'

const LAST_FOLDER_KEY = 'snarp:last-save-folder'

export function SaveButton({ itemType, itemId, isSaved, savedFolderId, savedItemId, onChange }) {
  const [saved, setSaved] = useState({ isSaved: !!isSaved, folderId: savedFolderId, itemId: savedItemId })
  const [folders, setFolders] = useState([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const ref = useRef(null)

  // Keep the control in sync when its parent refreshes feed data.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setSaved({ isSaved: !!isSaved, folderId: savedFolderId, itemId: savedItemId }), [isSaved, savedFolderId, savedItemId])

  useEffect(() => {
    const close = (event) => { if (ref.current && !ref.current.contains(event.target)) setOpen(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [])

  const loadFolders = async () => {
    const result = await api('/saved/folders')
    setFolders(result)
    return result
  }

  const saveTo = async (folderId) => {
    setBusy(true); setMessage('')
    try {
      const result = await api('/saved/items', { method: 'POST', body: { item_type: itemType, item_id: itemId, folder_id: folderId } })
      localStorage.setItem(LAST_FOLDER_KEY, String(folderId))
      const next = { isSaved: true, folderId: result.folder_id, itemId: result.id }
      setSaved(next); onChange?.({ is_saved: true, saved_folder_id: result.folder_id, saved_folder_name: result.folder_name, saved_item_id: result.id })
      setMessage(`Saved to ${result.folder_name}`)
      setOpen(false)
    } catch (err) { setMessage(err.message) }
    finally { setBusy(false) }
  }

  const toggle = async () => {
    if (busy) return
    if (saved.isSaved && saved.itemId) {
      setBusy(true)
      try { await api(`/saved/items/${saved.itemId}`, { method: 'DELETE' }); setSaved({ isSaved: false, folderId: null, itemId: null }); onChange?.({ is_saved: false, saved_item_id: null }); setMessage('Removed from saved') }
      catch (err) { setMessage(err.message) }
      finally { setBusy(false) }
      return
    }
    try {
      const available = folders.length ? folders : await loadFolders()
      const remembered = localStorage.getItem(LAST_FOLDER_KEY)
      const target = available.find((folder) => String(folder.id) === remembered) ?? available.find((folder) => folder.is_default)
      if (target) await saveTo(target.id)
    } catch (err) { setMessage(err.message) }
  }

  const openMenu = async (event) => {
    event.stopPropagation()
    try { if (!folders.length) await loadFolders(); setOpen((value) => !value) }
    catch (err) { setMessage(err.message) }
  }

  const createFolder = async () => {
    const name = window.prompt('Name your new folder')?.trim()
    if (!name) return
    try { const folder = await api('/saved/folders', { method: 'POST', body: { name } }); setFolders((items) => [...items, folder]); await saveTo(folder.id) }
    catch (err) { setMessage(err.message) }
  }

  return <span className="save-control" ref={ref}>
    <button type="button" className={`post-action-save ${saved.isSaved ? 'saved' : ''}`} onClick={toggle} aria-pressed={!!saved.isSaved} aria-label={saved.isSaved ? 'Remove from saved' : 'Save for later'} title={saved.isSaved ? `Saved to ${savedFolderName(saved.folderId, folders)}` : 'Save for later'}>
      <BookmarkSimple size={18} weight={saved.isSaved ? 'fill' : 'regular'} /> {saved.isSaved ? 'Saved' : 'Save'}
    </button>
    <button type="button" className="save-menu-trigger" onClick={openMenu} aria-label="Choose save folder" aria-expanded={open}><DotsThree size={18} weight="bold" /></button>
    {open && <div className="save-menu" role="menu">
      <strong>Save to folder</strong>
      {folders.map((folder) => <button type="button" role="menuitem" key={folder.id} onClick={() => saveTo(folder.id)} disabled={busy}><Folder size={16} /> {folder.name}</button>)}
      <button type="button" role="menuitem" className="save-menu-create" onClick={createFolder}><Plus size={16} /> New folder</button>
    </div>}
    {message && <span className="save-message" role="status"><Check size={14} /> {message}</span>}
  </span>
}

function savedFolderName(id, folders) { return folders.find((folder) => String(folder.id) === String(id))?.name ?? 'your library' }

function FolderDialog({ folder, onClose, onSaved }) {
  const [name, setName] = useState(folder?.name ?? '')
  const [error, setError] = useState('')
  const save = async (event) => {
    event.preventDefault(); setError('')
    try { const result = await api(folder ? `/saved/folders/${folder.id}` : '/saved/folders', { method: folder ? 'PATCH' : 'POST', body: { name } }); onSaved(result); onClose() }
    catch (err) { setError(err.message) }
  }
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <form className="panel folder-dialog" onSubmit={save} role="dialog" aria-modal="true" aria-labelledby="folder-dialog-title">
      <button type="button" className="icon-btn dialog-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
      <h2 id="folder-dialog-title">{folder ? 'Rename folder' : 'Create a folder'}</h2>
      <p className="muted-sm">Give your saved ideas a home you will want to return to.</p>
      <label className="field"><span>Folder name</span><input autoFocus maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Thesis ideas" /></label>
      {error && <p className="alert" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!name.trim()}>Save folder</button></div>
    </form>
  </div>
}

function SavedCard({ item, onRemove, onMove, onOpenPdf }) {
  const content = item.content
  if (item.item_type === 'post') return <article className="saved-card panel">
    <div className="saved-card-top"><span className="tag tag-orange">Post</span><time>{timeAgo(content.created_at)}</time><button className="icon-btn saved-remove" onClick={() => onRemove(item.id)} aria-label="Remove from saved"><BookmarkSimple size={19} weight="fill" /></button></div>
    {content.image_id && <img className="saved-card-image" src={`/api/images/${content.image_id}`} alt="" loading="lazy" />}
    <div className="saved-card-body"><div className="saved-author"><Avatar name={content.author_name} size="sm" /><strong>{content.author_name}</strong></div><p>{content.body || 'Image post'}</p></div>
    <div className="saved-card-foot"><span className="muted-sm">In {item.folder_name}</span><button className="link-button" onClick={() => onMove(item)}>Move</button></div>
  </article>
  const authors = (content.authors ?? []).map((author) => typeof author === 'string' ? author : author.name).filter(Boolean)
  return <article className="saved-card panel saved-paper-card">
    <div className="saved-card-top"><span className="tag tag-blue">Research paper</span><button className="icon-btn saved-remove" onClick={() => onRemove(item.id)} aria-label="Remove from saved"><BookmarkSimple size={19} weight="fill" /></button></div>
    <div className="paper-tile"><FilePdf size={28} weight="duotone" /><span>PDF</span></div>
    <div className="saved-card-body"><h3>{content.title}</h3><p className="article-authors">{authors.join(', ')}</p><p>{content.abstract}</p><div className="tag-row">{(content.tags ?? []).slice(0, 3).map((tag) => <span className="tag" key={tag}>#{tag}</span>)}</div></div>
    <div className="saved-card-foot"><span className="muted-sm">{content.domain}</span><div><button className="link-button" onClick={() => onMove(item)}>Move</button><button className="link-button" onClick={() => onOpenPdf(content.id)}><FilePdf size={14} /> View</button></div></div>
  </article>
}

export function Saved() {
  const [params, setParams] = useSearchParams()
  const [folders, setFolders] = useState([])
  const [items, setItems] = useState([])
  const [query, setQuery] = useState('')
  const [type, setType] = useState('all')
  const [sort, setSort] = useState('saved')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dialog, setDialog] = useState(null)
  const selectedId = params.get('folder')
  const selectedFolder = folders.find((folder) => String(folder.id) === selectedId)

  const load = async () => {
    setLoading(true); setError('')
    try { const nextFolders = await api('/saved/folders'); setFolders(nextFolders); const folder = params.get('folder'); setItems(await api(`/saved/items${folder ? `?folder=${folder}` : ''}`)) }
    catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }
  // Loading remote gallery state is the synchronization this effect owns.
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { load() }, [selectedId])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return [...items].filter((item) => {
      if (type !== 'all' && item.item_type !== type) return false
      if (!q) return true
      const content = item.content
      return [content.title, content.body, content.abstract, content.author_name, content.domain, ...(content.tags ?? [])].filter(Boolean).join(' ').toLowerCase().includes(q)
    }).sort((a, b) => sort === 'saved' ? new Date(b.saved_at) - new Date(a.saved_at) : sort === 'newest' ? new Date(b.content.created_at) - new Date(a.content.created_at) : new Date(a.content.created_at) - new Date(b.content.created_at))
  }, [items, query, type, sort])

  const remove = async (id) => { const previous = items; setItems((current) => current.filter((item) => item.id !== id)); try { await api(`/saved/items/${id}`, { method: 'DELETE' }); setFolders((current) => current.map((folder) => folder.id === selectedFolder?.id ? { ...folder, item_count: Math.max(0, folder.item_count - 1) } : folder)) } catch (err) { setItems(previous); setError(err.message) } }
  const move = async (item) => { const target = window.prompt(`Move “${item.content.title || item.content.body?.slice(0, 30) || 'this item'}” to folder id:\n${folders.map((folder) => `${folder.id}: ${folder.name}`).join('\n')}`, item.folder_id)?.trim(); if (!target || target === String(item.folder_id)) return; try { await api(`/saved/items/${item.id}`, { method: 'PATCH', body: { folder_id: target } }); await load() } catch (err) { setError(err.message) } }
  const deleteFolder = async () => { if (!selectedFolder || !window.confirm(`Delete “${selectedFolder.name}”? Its items will move to Unsorted.`)) return; try { await api(`/saved/folders/${selectedFolder.id}`, { method: 'DELETE' }); setParams({}); await load() } catch (err) { setError(err.message) } }
  const openPdf = async (id) => { const url = URL.createObjectURL(await apiBlob(`/papers/${id}/pdf`)); window.open(url, '_blank', 'noopener,noreferrer'); setTimeout(() => URL.revokeObjectURL(url), 60000) }

  return <div className="page saved-page">
    <PageHeader title="Saved" sub="Your personal library for ideas worth returning to."><button className="btn btn-primary" onClick={() => setDialog({ type: 'create' })}><Plus size={18} /> New folder</button></PageHeader>
    {error && <p className="alert" role="alert">{error}</p>}
    <div className="saved-layout">
      <aside className="saved-folders panel"><div className="saved-folders-head"><span>Library</span><BookmarkSimple size={18} weight="fill" /></div><button className={`saved-folder ${!selectedId ? 'active' : ''}`} onClick={() => setParams({})}><FolderOpen size={18} /><span>All saved</span><b>{folders.reduce((sum, folder) => sum + folder.item_count, 0)}</b></button>{folders.map((folder) => <button key={folder.id} className={`saved-folder ${String(folder.id) === selectedId ? 'active' : ''}`} onClick={() => setParams({ folder: folder.id })}><Folder size={18} /><span>{folder.name}</span><b>{folder.item_count}</b></button>)}{selectedFolder && !selectedFolder.is_default && <div className="folder-actions"><button onClick={() => setDialog({ type: 'edit', folder: selectedFolder })}><PencilSimple size={15} /> Rename</button><button onClick={deleteFolder}><Trash size={15} /> Delete</button></div>}</aside>
      <main className="saved-main"><div className="saved-toolbar"><label className="saved-search"><MagnifyingGlass size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your saved library" /></label><div className="saved-filters"><button className={type === 'all' ? 'active' : ''} onClick={() => setType('all')}>All</button><button className={type === 'post' ? 'active' : ''} onClick={() => setType('post')}>Posts</button><button className={type === 'paper' ? 'active' : ''} onClick={() => setType('paper')}>Papers</button><select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort saved items"><option value="saved">Recently saved</option><option value="newest">Newest content</option><option value="oldest">Oldest content</option></select></div></div>
        {loading ? <div className="saved-grid">{[1, 2, 3].map((id) => <div className="panel saved-skeleton" key={id} />)}</div> : visible.length ? <div className="saved-grid">{visible.map((item) => <SavedCard key={item.id} item={item} onRemove={remove} onMove={move} onOpenPdf={openPdf} />)}</div> : <div className="panel saved-empty"><div className="saved-empty-icon"><BookmarkSimple size={30} weight="duotone" /></div><h2>{query || type !== 'all' ? 'Nothing matches yet' : selectedFolder ? `Your ${selectedFolder.name} folder is ready` : 'Build your personal library'}</h2><p>{query || type !== 'all' ? 'Try another search or filter.' : 'Save a post or paper whenever it sparks an idea. It will be waiting here when you are ready.'}</p>{!selectedFolder && <Link className="btn btn-primary" to="/">Browse the feed <ArrowRight size={17} /></Link>}</div>}
      </main>
    </div>
    {dialog && <FolderDialog folder={dialog.folder} onClose={() => setDialog(null)} onSaved={async () => { setDialog(null); await load() }} />}
  </div>
}
