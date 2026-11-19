import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Trophy, Medal, Crown } from '@phosphor-icons/react'
import { PageHeader, Avatar } from './components/ui'
import { api } from './api'
import './Leaderboard.css'

const PERIODS = {
  weekly: { title: 'Weekly Leaderboard', endpoint: '/leaderboard', resets: 'Resets every Monday' },
  monthly: { title: 'Monthly Leaderboard', endpoint: '/leaderboard/monthly', resets: 'Resets on the 1st of every month' },
}

function RankIcon({ rank }) {
  if (rank === 1) return <Crown size={19} weight="fill" />
  if (rank === 2) return <Medal size={19} weight="fill" />
  if (rank === 3) return <Medal size={19} weight="regular" />
  return <span>{rank}</span>
}

export default function Leaderboard() {
  const [period, setPeriod] = useState('weekly')
  const [result, setResult] = useState({ period: null, rows: [], error: '' })

  useEffect(() => {
    let active = true
    api(PERIODS[period].endpoint)
      .then((data) => { if (active) setResult({ period, rows: data.leaderboard || [], error: '' }) })
      .catch((err) => { if (active) setResult({ period, rows: [], error: err.message }) })
    return () => { active = false }
  }, [period])

  const loading = result.period !== period
  const leaderboard = loading ? [] : result.rows

  return (
    <div className="page simple-leaderboard">
      <PageHeader title={PERIODS[period].title} sub="Recognizing researchers who contribute and help others." />

      <div className="lb-tabs" role="tablist">
        {Object.keys(PERIODS).map((key) => (
          <button key={key} type="button" role="tab" aria-selected={period === key} className={`lb-period-tab ${period === key ? 'active' : ''}`} onClick={() => setPeriod(key)}>
            {key === 'weekly' ? 'Weekly' : 'Monthly'}
          </button>
        ))}
      </div>

      <div className="lb-points panel">
        <div className="lb-points-title">
          <Trophy size={18} weight="fill" />
          <strong>How to earn points</strong>
          <span>{PERIODS[period].resets}</span>
        </div>
        <div className="lb-points-items">
          <span>Post <b>+3</b></span>
          <span>Like received <b>+1</b></span>
          <span>Comment on someone else&apos;s post <b>+1</b></span>
          <span>Published paper <b>+5</b></span>
        </div>
      </div>

      {!loading && result.error && <p className="alert" role="alert">{result.error}</p>}

      {loading ? (
        <p className="muted-sm" role="status">Loading leaderboard…</p>
      ) : leaderboard.length === 0 ? (
        <div className="panel lb-empty">
          <Trophy size={30} />
          <h3>No contributors yet</h3>
          <p>Start contributing to appear on the leaderboard!</p>
        </div>
      ) : (
        <div className="panel lb-table">
          <div className="lb-heading">
            <strong>Contributors</strong>
            <span>{leaderboard.length} {leaderboard.length === 1 ? 'researcher' : 'researchers'}</span>
          </div>
          {leaderboard.map((user, index) => {
            const rank = user.rank || index + 1
            return (
              <Link to={`/users/${user.id}`} className={`lb-row ${rank <= 3 ? `lb-top-${rank}` : ''}`} key={user.id}>
                <div className={`lb-rank lb-rank-${rank}`}><RankIcon rank={rank} /></div>
                <Avatar name={user.name} src={user.avatar_url} />
                <div className="lb-user">
                  <strong>{user.name}</strong>
                  <span>
                    {user.posts || 0} Posts · {user.likes_received || 0} Likes · {user.comments || 0} Comments · {user.research_papers || 0} Papers
                  </span>
                </div>
                <div className="lb-score">{user.score || 0}<small>pts</small></div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
