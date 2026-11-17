
import { useEffect, useState } from 'react'
import { Trophy, Medal, Crown } from '@phosphor-icons/react'
import { PageHeader, Avatar } from './components/ui'
import { api } from './api'

export default function Leaderboard() {
  const [leaderboard, setLeaderboard] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [period, setPeriod] = useState('weekly')

  useEffect(() => {
    setLoading(true)
    setError('')

    const endpoint =
      period === 'weekly' ? '/leaderboard' : '/leaderboard/monthly'

    api(endpoint)
      .then((data) => setLeaderboard(data.leaderboard || []))
      .catch((err) => {
        setLeaderboard([])
        setError(err.message)
      })
      .finally(() => setLoading(false))
  }, [period])

  const getRankIcon = (rank) => {
    if (rank === 1) {
      return <Crown size={19} weight="fill" />
    }

    if (rank === 2) {
      return <Medal size={19} weight="fill" />
    }

    if (rank === 3) {
      return <Medal size={19} weight="regular" />
    }

    return <span>{rank}</span>
  }

  return (
    <div className="page simple-leaderboard">
      <PageHeader
        title={period === 'weekly' ? 'Weekly Leaderboard' : 'Monthly Leaderboard'}
        sub="Recognizing learners who contribute and help others."
      />

      <div className="lb-tabs">
        <button
          className={`lb-period-tab ${period === 'weekly' ? 'active' : ''}`}
          onClick={() => setPeriod('weekly')}
        >
          Weekly
        </button>

        <button
          className={`lb-period-tab ${period === 'monthly' ? 'active' : ''}`}
          onClick={() => setPeriod('monthly')}
        >
          Monthly
        </button>
      </div>

      <div className="lb-points panel">
        <div className="lb-points-title">
          <Trophy size={18} weight="fill" />
          <strong>How to earn points</strong>
          <span>
            {period === 'weekly'
              ? 'Resets every Monday'
              : 'Resets on the 1st of every month'}
          </span>
        </div>

        <div className="lb-points-items">
          <span>Posts <b>+3</b></span>
          <span>Likes <b>+1</b></span>
          <span>Best answer <b>+5</b></span>
          <span>Approved paper <b>+5</b></span>
        </div>
      </div>

      {error && <p className="alert">{error}</p>}

      {loading ? (
        <p className="muted-sm">Loading leaderboard...</p>
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
            <span>{leaderboard.length} learners</span>
          </div>

          {leaderboard.map((user, index) => {
            const rank = user.rank || index + 1

            return (
              <div
                className={`lb-row ${rank <= 3 ? `lb-top-${rank}` : ''}`}
                key={user.id}
              >
                <div className={`lb-rank lb-rank-${rank}`}>
                  {getRankIcon(rank)}
                </div>

                <Avatar name={user.name} />

                <div className="lb-user">
                  <strong>{user.name}</strong>
                  <span>
                    {user.posts || 0} Posts
                    {' · '}
                    {user.likes_received || 0} Likes
                    {' · '}
                    {user.best_answers || 0} Best answers
                    {' · '}
                    {user.research_papers || 0} Papers
                  </span>
                </div>

                <div className="lb-score">
                  {user.score || 0}
                  <small>pts</small>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
