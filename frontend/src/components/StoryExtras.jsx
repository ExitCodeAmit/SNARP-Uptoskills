// Story extras from PR #21: poll / question / quiz stickers, reactions, replies, reshares,
// close friends and highlights, built on top of the stories composer and viewer.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChartBar, ChatCenteredDots, Question, X, Plus, Trash, PaperPlaneRight, ShareFat, Sparkle, Check } from '@phosphor-icons/react'
import { api } from '../api'
import { Avatar } from './ui'
import { timeAgo } from '../format'
import StoryPollCard from './stories/StoryPollCard'
import StoryQuestionCard from './stories/StoryQuestionCard'
import StoryQuizCard from './stories/StoryQuizCard'
import { STORY_REACTIONS } from './stories/storyHelpers'
import './stories/stories.css'
import './StoryExtras.css'
import { emptySticker, STICKER_PATH } from './story-kit'

const STICKERS = [
  { type: 'poll', label: 'Poll', icon: ChartBar },
  { type: 'question', label: 'Question', icon: ChatCenteredDots },
  { type: 'quiz', label: 'Quiz', icon: Question },
]
const stop = { onPointerDown: (e) => e.stopPropagation(), onPointerUp: (e) => e.stopPropagation(), onClick: (e) => e.stopPropagation() }

export function StickerEditor({ sticker, onChange, onClose }) {
  const set = (change) => onChange({ ...sticker, ...change })
  const setOption = (index, value) => set({ options: sticker.options.map((option, i) => (i === index ? value : option)) })
  const removeOption = (index) => set({
    options: sticker.options.filter((_, i) => i !== index),
    correct: sticker.correct === index ? 0 : sticker.correct > index ? sticker.correct - 1 : sticker.correct,
  })
  return (
    <div className="story-sticker-editor" role="dialog" aria-label="Sticker" {...stop}>
      <div className="story-sticker-tabs" role="tablist" aria-label="Sticker type">
        {STICKERS.map(({ type, label, icon: Icon }) => (
          <button key={type} type="button" role="tab" aria-selected={sticker.type === type} className={sticker.type === type ? 'active' : ''}
            onClick={() => onChange({ ...emptySticker(type), question: sticker.question })}>
            <Icon size={16} weight={sticker.type === type ? 'fill' : 'regular'} /> {label}
          </button>
        ))}
      </div>
      <label className="story-sticker-field">
        <span className="sr-only">Question</span>
        <input autoFocus value={sticker.question} maxLength={sticker.type === 'poll' ? 120 : 200} onChange={(e) => set({ question: e.target.value })}
          placeholder={sticker.type === 'question' ? 'Ask me anything…' : sticker.type === 'poll' ? 'Ask a question…' : 'Quiz question…'} />
      </label>
      {sticker.type !== 'question' && (
        <ol className="story-sticker-options">
          {sticker.options.map((option, index) => (
            <li key={index}>
              {sticker.type === 'quiz' && (
                <button type="button" className={`story-sticker-correct ${sticker.correct === index ? 'active' : ''}`} onClick={() => set({ correct: index })}
                  aria-pressed={sticker.correct === index} aria-label={`Mark option ${index + 1} as the right answer`} title="Right answer"><Check size={14} weight="bold" /></button>
              )}
              <input value={option} maxLength={60} onChange={(e) => setOption(index, e.target.value)} placeholder={`Option ${index + 1}`} aria-label={`Option ${index + 1}`} />
              {sticker.options.length > 2 && <button type="button" className="story-sticker-remove" onClick={() => removeOption(index)} aria-label={`Remove option ${index + 1}`}><X size={14} /></button>}
            </li>
          ))}
        </ol>
      )}
      {sticker.type !== 'question' && sticker.options.length < 4 && (
        <button type="button" className="story-sticker-add" onClick={() => set({ options: [...sticker.options, ''] })}><Plus size={14} /> Add option</button>
      )}
      {sticker.type === 'quiz' && <p className="story-sticker-hint">Tick the right answer. Viewers see if they got it right.</p>}
      <div className="story-sticker-foot">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(null)}><Trash size={14} /> Remove</button>
        <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>Done</button>
      </div>
    </div>
  )
}

export function StickerChip({ sticker, onClick }) {
  const meta = STICKERS.find((item) => item.type === sticker.type)
  const Icon = meta.icon
  return (
    <button type="button" className="story-sticker-chip" onClick={(e) => { e.stopPropagation(); onClick() }} title="Edit sticker">
      <Icon size={16} weight="fill" /> <span>{sticker.question.trim() || meta.label}</span>
    </button>
  )
}

// The sticker on a story. Viewers answer it; the owner sees the results.
export function StoryStickers({ story, mine, onPause, onResults }) {
  const [data, setData] = useState({ id: null, item: null })
  const path = STICKER_PATH[story.sticker]

  useEffect(() => {
    if (!path) return undefined
    let active = true
    api(`/stories/${story.id}/${path}`).then((item) => { if (active) setData({ id: story.id, item }) }).catch(() => { if (active) setData({ id: story.id, item: null }) })
    return () => { active = false }
  }, [story.id, path])

  if (!path || data.id !== story.id || !data.item) return null
  const update = (key) => (result) => { if (result?.[key]) setData({ id: story.id, item: result[key] }); return result }
  const send = (sub, body, key) => api(`/stories/${story.id}/${path}/${sub}`, { method: 'POST', body }).then(update(key))
  return (
    <div className="story-sticker" {...stop}>
      {story.sticker === 'poll' && <StoryPollCard poll={data.item} isOwner={mine} onVote={(optionId) => send('vote', { optionId }, 'poll')} />}
      {story.sticker === 'question' && (
        <StoryQuestionCard question={data.item} isOwner={mine} onOpenDrawer={onResults}
          onRespond={(response) => send('respond', { response }, 'question')} onAnswerFocus={() => onPause(true)} onAnswerBlur={() => onPause(false)} />
      )}
      {story.sticker === 'quiz' && (
        <StoryQuizCard quiz={data.item} isOwner={mine} onOpenDrawer={onResults}
          onAnswer={(optionId) => send('answer', { optionId }, 'quiz')} onAnswerFocus={() => onPause(true)} onAnswerBlur={() => onPause(false)} />
      )}
    </div>
  )
}

// Reactions, a private reply and (for people mentioned in it) resharing, for someone else's story.
export function StoryReplyBar({ story, onPause, onReshared }) {
  const [reaction, setReaction] = useState({ id: story.id, type: story.my_reaction })
  const [text, setText] = useState('')
  const [state, setState] = useState({ busy: false, note: '', error: '' })
  const [reshared, setReshared] = useState(null)
  const mine = reaction.id === story.id ? reaction.type : story.my_reaction

  const react = async (type) => {
    const next = mine === type ? null : type
    setReaction({ id: story.id, type: next })
    try {
      if (next) await api(`/stories/${story.id}/reactions`, { method: 'POST', body: { type } })
      else await api(`/stories/${story.id}/reactions`, { method: 'DELETE' })
    } catch (err) {
      setReaction({ id: story.id, type: mine })
      setState({ busy: false, note: '', error: err.message })
    }
  }

  const reply = async (e) => {
    e.preventDefault()
    const body = text.trim()
    if (!body || state.busy) return
    setState({ busy: true, note: '', error: '' })
    try {
      await api(`/stories/${story.id}/replies`, { method: 'POST', body: { text: body } })
      setText('')
      setState({ busy: false, note: 'Reply sent', error: '' })
      setTimeout(() => setState((current) => (current.note === 'Reply sent' ? { ...current, note: '' } : current)), 2500)
    } catch (err) { setState({ busy: false, note: '', error: err.message }) }
  }

  const reshare = async () => {
    setState({ busy: true, note: '', error: '' })
    try {
      await api(`/stories/${story.id}/reshare`, { method: 'POST', body: {} })
      setReshared(story.id)
      setState({ busy: false, note: 'Added to your story', error: '' })
      onReshared?.()
    } catch (err) { setState({ busy: false, note: '', error: err.message }) }
  }

  return (
    <div className="story-reply-bar" {...stop}>
      {(state.note || state.error) && <p className={state.error ? 'story-reply-error' : 'story-reply-note'} role={state.error ? 'alert' : 'status'}>{state.error || state.note}</p>}
      <div className="story-reactions" role="group" aria-label="React to this story">
        {STORY_REACTIONS.map(({ type, emoji, label }) => (
          <button key={type} type="button" className={mine === type ? 'active' : ''} aria-pressed={mine === type} aria-label={label} title={label} onClick={() => react(type)}>{emoji}</button>
        ))}
        {story.can_reshare && reshared !== story.id && (
          <button type="button" className="story-reshare" onClick={reshare} disabled={state.busy} title="You were mentioned. Add this to your story."><ShareFat size={16} /> Reshare</button>
        )}
      </div>
      <form className="story-reply" onSubmit={reply}>
        <input value={text} maxLength={500} onChange={(e) => setText(e.target.value)} onFocus={() => onPause(true)} onBlur={() => onPause(false)}
          placeholder="Send a private reply…" aria-label="Reply to this story" />
        <button type="submit" disabled={!text.trim() || state.busy} aria-label="Send reply"><PaperPlaneRight size={18} weight="fill" /></button>
      </form>
    </div>
  )
}

const person = (id, name, avatar, extra, onLeave) => (
  <Link to={`/users/${id}`} onClick={onLeave} className="story-activity-person">
    <Avatar name={name} src={avatar} size="sm" />
    <span><strong>{name}</strong>{extra && <small>{extra}</small>}</span>
  </Link>
)

// For the owner, inside the viewers sheet: reactions, replies and the sticker's answers.
export function StoryActivity({ story, onLeave }) {
  const [data, setData] = useState(null)
  const [shared, setShared] = useState({})
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    const path = STICKER_PATH[story.sticker]
    const results = { poll: 'voters', question: 'responses', quiz: 'responses' }[story.sticker]
    Promise.all([
      api(`/stories/${story.id}/reactions`).catch(() => null),
      api(`/stories/${story.id}/replies`).catch(() => null),
      path ? api(`/stories/${story.id}/${path}/${results}`).catch(() => null) : null,
    ]).then(([reactions, replies, sticker]) => { if (active) setData({ reactions, replies, sticker }) })
    return () => { active = false }
  }, [story.id, story.sticker])

  if (!data) return null
  const shareAnswer = async (responseId) => {
    setError('')
    try {
      await api(`/stories/${story.id}/questions/share`, { method: 'POST', body: { responseId } })
      setShared((current) => ({ ...current, [responseId]: true }))
    } catch (err) { setError(err.message) }
  }
  const counts = data.reactions?.counts ?? {}
  return (
    <section className="story-activity" aria-label="Story activity">
      {data.reactions?.reactionCount > 0 && (
        <div className="story-activity-reactions">
          {STORY_REACTIONS.filter(({ type }) => counts[type] > 0).map(({ type, emoji, label }) => <span key={type} title={label}>{emoji} {counts[type]}</span>)}
        </div>
      )}
      {story.sticker === 'poll' && data.sticker && (
        <div className="story-activity-block">
          <h3>Poll · {data.sticker.totalVotes} {data.sticker.totalVotes === 1 ? 'vote' : 'votes'}</h3>
          {data.sticker.options.map((option) => (
            <div key={option.id} className="story-activity-option">
              <p><strong>{option.option_text}</strong> <small>{option.percentage}%</small></p>
              {option.voters.map((voter) => <div key={voter.user_id}>{person(voter.user_id, voter.voter_name, voter.voter_avatar_url, '', onLeave)}</div>)}
            </div>
          ))}
        </div>
      )}
      {story.sticker === 'quiz' && data.sticker && (
        <div className="story-activity-block">
          <h3>Quiz · {data.sticker.correctCount} of {data.sticker.totalResponses} right</h3>
          {data.sticker.options.map((option) => (
            <div key={option.id} className="story-activity-option">
              <p><strong>{option.option_text}</strong> {option.is_correct && <Check size={14} weight="bold" aria-label="Right answer" />} <small>{option.percentage}%</small></p>
              {option.respondents.map((item) => <div key={item.user_id}>{person(item.user_id, item.name, item.avatar_url, '', onLeave)}</div>)}
            </div>
          ))}
        </div>
      )}
      {story.sticker === 'question' && data.sticker && (
        <div className="story-activity-block">
          <h3>Answers · {data.sticker.totalResponses}</h3>
          {data.sticker.responses.map((item) => (
            <div key={item.id} className="story-activity-answer">
              {person(item.responder_id, item.responder_name, item.responder_avatar_url, item.response_text, onLeave)}
              <button type="button" className="btn btn-ghost btn-sm" disabled={item.shared_story_id || shared[item.id]} onClick={() => shareAnswer(item.id)}>
                {item.shared_story_id || shared[item.id] ? 'Shared' : 'Share'}
              </button>
            </div>
          ))}
        </div>
      )}
      {data.replies?.replies?.length > 0 && (
        <div className="story-activity-block">
          <h3>Replies · {data.replies.count}</h3>
          {data.replies.replies.map((item) => <div key={item.id}>{person(item.sender_id, item.sender_name, item.sender_avatar_url, `${item.text} · ${timeAgo(item.created_at)}`, onLeave)}</div>)}
        </div>
      )}
      {error && <p className="story-sheet-error" role="alert">{error}</p>}
    </section>
  )
}

// For the owner: keep a story on their profile after it expires.
export function AddToHighlight({ story, me, onClose }) {
  const [highlights, setHighlights] = useState(null)
  const [title, setTitle] = useState('')
  const [state, setState] = useState({ busy: false, done: '', error: '' })

  useEffect(() => {
    let active = true
    api(`/stories/highlights/user/${me.id}`).then((result) => { if (active) setHighlights(result.highlights) }).catch(() => { if (active) setHighlights([]) })
    return () => { active = false }
  }, [me.id])

  const run = async (call, done) => {
    setState({ busy: true, done: '', error: '' })
    try {
      await call()
      setState({ busy: false, done, error: '' })
      setTimeout(onClose, 900)
    } catch (err) { setState({ busy: false, done: '', error: err.message }) }
  }
  const create = (e) => {
    e.preventDefault()
    if (!title.trim()) return
    run(() => api('/stories/highlights', { method: 'POST', body: { title: title.trim(), storyIds: [story.id], coverStoryId: story.id } }), 'Highlight created')
  }
  return (
    <div className="story-sheet story-highlight-sheet" role="dialog" aria-label="Add to highlight" {...stop}>
      <span className="story-sheet-grip" aria-hidden="true" />
      <header className="story-sheet-head">
        <h2><Sparkle size={18} /> Add to highlight</h2>
        <button type="button" className="story-sheet-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
      </header>
      <p className="story-sheet-note">Highlights stay on your profile after the story ends, for the same people who could see the story.</p>
      <ul className="story-highlight-pick">
        {highlights?.map((item) => (
          <li key={item.id}>
            <button type="button" disabled={state.busy} onClick={() => run(() => api(`/stories/highlights/${item.id}/items`, { method: 'POST', body: { storyId: story.id } }), `Added to ${item.title}`)}>
              <Sparkle size={16} /> <span>{item.title}</span> <small>{item.story_count}</small>
            </button>
          </li>
        ))}
      </ul>
      <form className="story-highlight-new" onSubmit={create}>
        <input value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} placeholder="New highlight name" aria-label="New highlight name" />
        <button type="submit" className="btn btn-primary btn-sm" disabled={!title.trim() || state.busy}>Create</button>
      </form>
      {state.done && <p className="story-reply-note" role="status">{state.done}</p>}
      {state.error && <p className="story-sheet-error" role="alert">{state.error}</p>}
    </div>
  )
}

const coverStyle = (item, backgrounds) => (item.cover_type === 'text'
  ? { background: backgrounds[item.cover_background_style] ?? backgrounds.night }
  : undefined)

// Highlight circles on a profile. Opening one plays its stories in the stories viewer.
export function ProfileHighlights({ profile, isMe, backgrounds, renderViewer }) {
  const [highlights, setHighlights] = useState([])
  const [open, setOpen] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    api(`/stories/highlights/user/${profile.id}`).then((result) => { if (active) setHighlights(result.highlights ?? []) }).catch(() => {})
    return () => { active = false }
  }, [profile.id])

  const play = async (item) => {
    setError('')
    try {
      const result = await api(`/stories/highlights/${item.id}`)
      const items = (result.stories ?? []).map((story) => ({ ...story, seen: true }))
      if (!items.length) { setError('There is nothing in this highlight you can see.'); return }
      setOpen({ highlight: item, groups: [{ user: { id: profile.id, name: profile.name, avatar_url: profile.avatar_url }, mine: isMe, items }] })
    } catch (err) { setError(err.message) }
  }

  const remove = async (item) => {
    if (!window.confirm(`Delete the highlight "${item.title}"? The stories in it are not deleted.`)) return
    try {
      await api(`/stories/highlights/${item.id}`, { method: 'DELETE' })
      setHighlights((list) => list.filter((entry) => entry.id !== item.id))
    } catch (err) { setError(err.message) }
  }

  if (!highlights.length) return null
  return (
    <section className="profile-highlights" aria-label="Story highlights">
      <ul>
        {highlights.map((item) => (
          <li key={item.id}>
            <button type="button" className="profile-highlight" onClick={() => play(item)} aria-label={`Open highlight ${item.title}`}>
              <span className="profile-highlight-cover" style={coverStyle(item, backgrounds)}>
                {item.cover_media_url && item.cover_type === 'image' && <img src={item.cover_media_url} alt="" loading="lazy" />}
                {item.cover_media_url && item.cover_type === 'video' && <video src={item.cover_media_url} muted preload="metadata" />}
                {item.cover_type === 'text' && <Sparkle size={20} weight="fill" />}
              </span>
              <span className="profile-highlight-title">{item.title}</span>
            </button>
            {isMe && <button type="button" className="profile-highlight-delete" onClick={() => remove(item)} aria-label={`Delete highlight ${item.title}`}><X size={12} weight="bold" /></button>}
          </li>
        ))}
      </ul>
      {error && <p className="field-error" role="alert">{error}</p>}
      {open && renderViewer({
        groups: open.groups,
        onClose: () => setOpen(null),
        onDeleted: () => { setOpen(null); setHighlights((list) => list.map((entry) => (entry.id === open.highlight.id ? { ...entry, story_count: entry.story_count - 1 } : entry)).filter((entry) => entry.story_count > 0)) },
      })}
    </section>
  )
}
