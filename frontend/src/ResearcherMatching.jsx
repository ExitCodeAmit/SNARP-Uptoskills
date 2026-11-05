import { useEffect, useState } from 'react'
import { api } from './api'

const SUGGESTED_INTERESTS = [
  'IoT',
  'VLSI',
  'Embedded Systems',
  'AI/ML',
  'Web Development',
  'Machine Learning',
  'Data Science',
  'Computer Networks',
  'Cybersecurity',
  'Robotics',
]

const EMPTY_PROFILE = {
  bio: '',
  institution: '',
  research_domain: '',
  skills: [],
  projects: '',
  publications: '',
  availability: 'open',
}

export default function ResearcherMatching() {
  const [currentUserId, setCurrentUserId] = useState(null)

  const [interests, setInterests] = useState([])
  const [interestInput, setInterestInput] = useState('')
  const [matches, setMatches] = useState([])
  const [requests, setRequests] = useState([])
  const [profile, setProfile] = useState(EMPTY_PROFILE)
  const [skillsInput, setSkillsInput] = useState('')

  // AI Smart Fill states
  const [smartFilling, setSmartFilling] = useState(false)
  const [smartFillError, setSmartFillError] = useState('')

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)

  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const [selectedProfile, setSelectedProfile] = useState(null)
  const [profileLoading, setProfileLoading] = useState(false)

  async function loadData() {
    try {
      setLoading(true)
      setError('')

      const [
        userData,
        interestsData,
        matchesData,
        requestsData,
        profileData,
      ] = await Promise.all([
        api('/auth/me'),
        api('/researchers/interests'),
        api('/researchers/matches'),
        api('/collaborations'),
        api('/researchers/profile'),
      ])

      setCurrentUserId(userData.id)

      setInterests(
        Array.isArray(interestsData)
          ? interestsData
          : interestsData.interests || []
      )

      setMatches(
        Array.isArray(matchesData)
          ? matchesData
          : matchesData.matches || []
      )

      setRequests(
        Array.isArray(requestsData)
          ? requestsData
          : requestsData.requests || []
      )

      const savedProfile =
        profileData.profile || profileData || EMPTY_PROFILE

      setProfile({
        ...EMPTY_PROFILE,
        ...savedProfile,
        skills: Array.isArray(savedProfile.skills)
          ? savedProfile.skills
          : [],
      })

      setSkillsInput(
        (Array.isArray(savedProfile.skills)
          ? savedProfile.skills
          : []
        ).join(', ')
      )
    } catch (err) {
      setError(err.message || 'Failed to load researcher data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  // Separate requests based on the logged-in user's ID.
  const incomingRequests = requests.filter(
    (item) => Number(item.receiver_id) === Number(currentUserId)
  )

  const outgoingRequests = requests.filter(
    (item) => Number(item.sender_id) === Number(currentUserId)
  )

  const pendingRequests = requests.filter(
    (item) => item.status === 'pending'
  )

  function getStatusLabel(status) {
    switch (status) {
      case 'accepted':
        return 'Accepted'
      case 'rejected':
        return 'Rejected'
      default:
        return 'Pending'
    }
  }

  async function saveInterests() {
    const newInterest = interestInput.trim()

    if (!newInterest) return

    try {
      setSaving(true)
      setError('')
      setMessage('')

      const uniqueInterests = [
        ...new Set([...interests, newInterest]),
      ]

      const data = await api('/researchers/interests', {
        method: 'PUT',
        body: { interests: uniqueInterests },
      })

      setInterests(data.interests || uniqueInterests)
      setInterestInput('')
      setMessage('Research interests saved successfully!')
      await loadData()
    } catch (err) {
      setError(err.message || 'Could not save interests')
    } finally {
      setSaving(false)
    }
  }

  async function removeInterest(interest) {
    try {
      setError('')
      setMessage('')

      const updatedInterests = interests.filter(
        (item) => item !== interest
      )

      const data = await api('/researchers/interests', {
        method: 'PUT',
        body: { interests: updatedInterests },
      })

      setInterests(data.interests || updatedInterests)
      setMessage('Interest removed successfully!')
    } catch (err) {
      setError(err.message || 'Could not remove interest')
    }
  }

  async function saveProfile(event) {
    event.preventDefault()

    try {
      setSavingProfile(true)
      setError('')
      setMessage('')
      setSmartFillError('')

      const skills = skillsInput
        .split(',')
        .map((skill) => skill.trim())
        .filter(Boolean)

      const data = await api('/researchers/profile', {
        method: 'PUT',
        body: {
          ...profile,
          skills,
        },
      })

      const saved = data.profile || data

      setProfile({
        ...EMPTY_PROFILE,
        ...saved,
        skills,
      })

      setSkillsInput(skills.join(', '))
      setMessage('Researcher profile saved successfully!')
    } catch (err) {
      setError(err.message || 'Could not save profile')
    } finally {
      setSavingProfile(false)
    }
  }

  // AI Smart Fill: analyse all papers and populate the profile form.
  async function handleSmartFill() {
    try {
      setSmartFilling(true)
      setSmartFillError('')
      setError('')
      setMessage('')

      const data = await api('/researchers/profile/smart-fill', {
        method: 'POST',
        body: {},
      })

      const suggestions = data.suggestions

      if (!suggestions || typeof suggestions !== 'object') {
        throw new Error('Invalid suggestions received from AI')
      }

      const suggestedSkills = Array.isArray(suggestions.skills)
        ? suggestions.skills
        : typeof suggestions.skills === 'string'
          ? suggestions.skills
              .split(',')
              .map((skill) => skill.trim())
              .filter(Boolean)
          : []

      // Update the form only. Do not save automatically.
      setProfile((previous) => ({
        ...previous,
        bio: suggestions.bio || previous.bio,
        institution:
          suggestions.institution || previous.institution,
        research_domain:
          suggestions.research_domain || previous.research_domain,
        skills: suggestedSkills.length
          ? suggestedSkills
          : previous.skills,
        projects: suggestions.projects || previous.projects,
        publications:
          suggestions.publications || previous.publications,
      }))

      if (suggestedSkills.length > 0) {
        setSkillsInput(suggestedSkills.join(', '))
      }

      setMessage(
        `AI suggestions generated from ${data.paperCount} research paper(s). Please review and edit before saving.`
      )
    } catch (err) {
      setSmartFillError(
        err.message || 'Unable to generate AI suggestions'
      )
    } finally {
      setSmartFilling(false)
    }
  }

  async function viewProfile(researcherId) {
    try {
      setProfileLoading(true)
      setSelectedProfile(null)
      setError('')

      const data = await api(
        `/researchers/${researcherId}/profile`
      )

      setSelectedProfile(data.profile || data)
    } catch (err) {
      setError(err.message || 'Could not load researcher profile')
    } finally {
      setProfileLoading(false)
    }
  }

  async function sendRequest(receiverId) {
    try {
      setError('')
      setMessage('')

      await api('/collaborations', {
        method: 'POST',
        body: { receiverId },
      })

      setMessage('Collaboration request sent!')
      await loadData()
    } catch (err) {
      setError(err.message || 'Could not send request')
    }
  }

  async function respondToRequest(requestId, status) {
    try {
      setError('')
      setMessage('')

      await api(`/collaborations/${requestId}`, {
        method: 'PATCH',
        body: { status },
      })

      setMessage(
        status === 'accepted'
          ? 'Collaboration request accepted!'
          : 'Collaboration request rejected!'
      )

      await loadData()
    } catch (err) {
      setError(err.message || 'Could not update request')
    }
  }

  if (loading) {
    return (
      <div className="rm-page">
        <div className="rm-empty">
          Loading researcher matching...
        </div>
      </div>
    )
  }

  return (
    <div className="rm-page">

      {/* Page Header */}
      <div className="rm-header">
        <h2>Researcher Matching</h2>
        <p>
          Connect with researchers, discover shared interests,
          and build collaborations.
        </p>
      </div>

      {error && <div className="rm-error">{error}</div>}
      {message && <div className="rm-success">{message}</div>}

      {/* Research Collaboration Overview */}
      <div className="rm-dashboard">
        <div className="rm-stat-card">
          <span className="rm-stat-icon">🔍</span>
          <div>
            <h3>{matches.length}</h3>
            <p>Research Matches</p>
          </div>
        </div>

        <div className="rm-stat-card">
          <span className="rm-stat-icon">💡</span>
          <div>
            <h3>{interests.length}</h3>
            <p>Research Interests</p>
          </div>
        </div>

        <div className="rm-stat-card">
          <span className="rm-stat-icon">🤝</span>
          <div>
            <h3>{pendingRequests.length}</h3>
            <p>Pending Requests</p>
          </div>
        </div>
      </div>

      {/* Research Interests */}
      <section className="rm-section">
        <h3>My Research Interests</h3>

        <form
          className="rm-add-form"
          onSubmit={(e) => {
            e.preventDefault()
            saveInterests()
          }}
        >
          <input
            value={interestInput}
            onChange={(e) => setInterestInput(e.target.value)}
            placeholder="Enter a research interest"
          />

          <button
            className="rm-button"
            type="submit"
            disabled={saving || !interestInput.trim()}
          >
            {saving ? 'Saving...' : 'Add Interest'}
          </button>
        </form>

        <div className="rm-suggestions">
          {SUGGESTED_INTERESTS.map((item) => (
            <button
              type="button"
              key={item}
              onClick={() => setInterestInput(item)}
            >
              {item}
            </button>
          ))}
        </div>

        <div className="rm-interest-list">
          {interests.map((interest) => (
            <span className="rm-interest-tag" key={interest}>
              {interest}
              <button
                type="button"
                onClick={() => removeInterest(interest)}
                aria-label={`Remove ${interest}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      </section>

      {/* My Researcher Profile */}
      <section className="rm-section">
        <h3>My Researcher Profile</h3>

        <form className="rm-profile-form" onSubmit={saveProfile}>

          {/* AI Smart Fill */}
          <div className="rm-smart-fill">
            <h4>✨ AI-Powered Profile Assistant</h4>

            <p>
              Generate profile suggestions by analysing all
              your uploaded research papers.
            </p>

            <button
              type="button"
              className="rm-button"
              onClick={handleSmartFill}
              disabled={smartFilling || savingProfile}
            >
              {smartFilling
                ? '✨ Analysing Your Papers...'
                : '✨ Generate with AI Smart Fill'}
            </button>

            {smartFillError && (
              <div className="rm-error">
                {smartFillError}
              </div>
            )}
          </div>

          <label>
            Bio
            <textarea
              rows="3"
              value={profile.bio}
              onChange={(e) =>
                setProfile({ ...profile, bio: e.target.value })
              }
              placeholder="Tell other researchers about yourself"
            />
          </label>

          <label>
            Institution
            <input
              value={profile.institution}
              onChange={(e) =>
                setProfile({
                  ...profile,
                  institution: e.target.value,
                })
              }
              placeholder="College or organization"
            />
          </label>

          <label>
            Research Domain
            <input
              value={profile.research_domain}
              onChange={(e) =>
                setProfile({
                  ...profile,
                  research_domain: e.target.value,
                })
              }
              placeholder="Example: Embedded Systems"
            />
          </label>

          <label>
            Skills (comma separated)
            <input
              value={skillsInput}
              onChange={(e) => setSkillsInput(e.target.value)}
              placeholder="Python, C, IoT, Machine Learning"
            />
          </label>

          <label>
            Projects
            <textarea
              rows="3"
              value={profile.projects}
              onChange={(e) =>
                setProfile({
                  ...profile,
                  projects: e.target.value,
                })
              }
              placeholder="Describe your projects"
            />
          </label>

          <label>
            Publications
            <textarea
              rows="3"
              value={profile.publications}
              onChange={(e) =>
                setProfile({
                  ...profile,
                  publications: e.target.value,
                })
              }
              placeholder="Add your publications"
            />
          </label>

          <label>
            Availability
            <select
              value={profile.availability}
              onChange={(e) =>
                setProfile({
                  ...profile,
                  availability: e.target.value,
                })
              }
            >
              <option value="open">Open to Collaboration</option>
              <option value="busy">Busy</option>
              <option value="unavailable">Unavailable</option>
            </select>
          </label>

          <button
            className="rm-button"
            type="submit"
            disabled={savingProfile || smartFilling}
          >
            {savingProfile ? 'Saving...' : 'Save Profile'}
          </button>
        </form>
      </section>

      {/* Recommended Researchers */}
      <section className="rm-section">
        <h3>Recommended Researchers</h3>

        {matches.length === 0 ? (
          <div className="rm-empty">
            No matching researchers found yet.
            Add your interests to discover researchers.
          </div>
        ) : (
          <div className="rm-researcher-grid">
            {matches.map((researcher) => {
              const researcherId = Number(researcher.id)
              const loggedInUserId = Number(currentUserId)

              const incomingPending = requests.some(
                (item) =>
                  Number(item.sender_id) === researcherId &&
                  Number(item.receiver_id) === loggedInUserId &&
                  item.status === 'pending'
              )

              const outgoingPending = requests.some(
                (item) =>
                  Number(item.sender_id) === loggedInUserId &&
                  Number(item.receiver_id) === researcherId &&
                  item.status === 'pending'
              )

              const alreadyConnected = requests.some(
                (item) =>
                  (
                    (
                      Number(item.sender_id) === loggedInUserId &&
                      Number(item.receiver_id) === researcherId
                    ) ||
                    (
                      Number(item.sender_id) === researcherId &&
                      Number(item.receiver_id) === loggedInUserId
                    )
                  ) &&
                  item.status === 'accepted'
              )

              return (
                <div className="rm-researcher" key={researcher.id}>
                  <div className="rm-avatar">
                    {researcher.name?.charAt(0)?.toUpperCase() || 'R'}
                  </div>

                  <div className="rm-researcher-info">
                    <h4>{researcher.name}</h4>

                    <p className="rm-role">
                      {researcher.role || 'Researcher'}
                    </p>

                    <p className="rm-detail">
                      🏫 {researcher.institution || 'Institution not added'}
                    </p>

                    <p className="rm-detail">
                      🔬 {researcher.research_domain || 'Research domain not added'}
                    </p>

                    <span
                      className={`rm-availability rm-availability-${researcher.availability || 'open'}`}
                    >
                      {researcher.availability === 'busy'
                        ? 'Busy'
                        : researcher.availability === 'unavailable'
                          ? 'Unavailable'
                          : 'Open to Collaboration'}
                    </span>
                  </div>

                  <span className="rm-match-count">
                    {(researcher.shared_interests || []).length}
                    {' '}Shared Interests
                  </span>

                  <p className="rm-match-reason">
                    <strong>Why this match?</strong>
                    {' '}You both are interested in{' '}
                    {(researcher.shared_interests || []).join(', ')}.
                  </p>

                  <div className="rm-interest-list">
                    {(researcher.shared_interests || []).map((item) => (
                      <span className="rm-interest-tag" key={item}>
                        {item}
                      </span>
                    ))}
                  </div>

                  <div className="rm-actions">
                    <button
                      className="rm-button"
                      type="button"
                      onClick={() => viewProfile(researcher.id)}
                    >
                      View Profile
                    </button>

                    {alreadyConnected ? (
                      <button className="rm-connected-button" disabled>
                        ✓ Connected
                      </button>
                    ) : incomingPending ? (
                      <span className="rm-match-count">
                        Request Received
                      </span>
                    ) : outgoingPending ? (
                      <button className="rm-button" disabled>
                        Request Sent
                      </button>
                    ) : (
                      <button
                        className="rm-button"
                        type="button"
                        onClick={() => sendRequest(researcher.id)}
                      >
                        Collaborate
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
      {/* Collaboration Requests */}
      <section className="rm-section">
        <h3>Collaboration Requests</h3>

        {/* Incoming Requests */}
        <div className="rm-request-group">
          <div className="rm-request-heading">
            <h4>Incoming Requests</h4>
            <span>{incomingRequests.length}</span>
          </div>

          {incomingRequests.length === 0 ? (
            <div className="rm-empty">
              You haven't received any collaboration requests yet.
            </div>
          ) : (
            <div className="rm-request-list">
              {incomingRequests.map((item) => (
                <div className="rm-request-card" key={item.id}>
                  <div className="rm-request-person">
                    <div className="rm-request-avatar">
                      {item.sender_name?.charAt(0)?.toUpperCase() || 'R'}
                    </div>

                    <div>
                      <strong>
                        {item.sender_name || `User ${item.sender_id}`}
                      </strong>
                      <p>Wants to collaborate with you</p>
                    </div>
                  </div>

                  <div className="rm-request-meta">
                    <span
                      className={`rm-status rm-status-${item.status}`}
                    >
                      {getStatusLabel(item.status)}
                    </span>

                    {item.status === 'pending' && (
                      <div className="rm-request-actions">
                        <button
                          className="rm-accept-button"
                          type="button"
                          onClick={() =>
                            respondToRequest(item.id, 'accepted')
                          }
                        >
                          Accept
                        </button>

                        <button
                          className="rm-reject-button"
                          type="button"
                          onClick={() =>
                            respondToRequest(item.id, 'rejected')
                          }
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Outgoing Requests */}
        <div className="rm-request-group">
          <div className="rm-request-heading">
            <h4>Outgoing Requests</h4>
            <span>{outgoingRequests.length}</span>
          </div>

          {outgoingRequests.length === 0 ? (
            <div className="rm-empty">
              You haven't sent any collaboration requests yet.
            </div>
          ) : (
            <div className="rm-request-list">
              {outgoingRequests.map((item) => (
                <div className="rm-request-card" key={item.id}>
                  <div className="rm-request-person">
                    <div className="rm-request-avatar">
                      {item.receiver_name?.charAt(0)?.toUpperCase() || 'R'}
                    </div>

                    <div>
                      <strong>
                        {item.receiver_name || `User ${item.receiver_id}`}
                      </strong>
                      <p>Collaboration request sent</p>
                    </div>
                  </div>

                  <div className="rm-request-meta">
                    <span
                      className={`rm-status rm-status-${item.status}`}
                    >
                      {getStatusLabel(item.status)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Loading Profile Popup */}
      {profileLoading && (
        <div className="rm-modal-overlay">
          <div className="rm-modal">
            Loading researcher profile...
          </div>
        </div>
      )}

      {/* Researcher Profile Popup */}
      {selectedProfile && (
        <div
          className="rm-modal-overlay"
          onClick={() => setSelectedProfile(null)}
        >
          <div
            className="rm-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="rm-modal-close"
              type="button"
              onClick={() => setSelectedProfile(null)}
            >
              ×
            </button>

            <div className="rm-avatar">
              {selectedProfile.name?.charAt(0)?.toUpperCase() || 'R'}
            </div>

            <h2>{selectedProfile.name}</h2>

            <p className="rm-role">
              {selectedProfile.role || 'Researcher'}
            </p>

            <hr />

            <h4>Institution</h4>
            <p>{selectedProfile.institution || 'Not provided'}</p>

            <h4>About</h4>
            <p>{selectedProfile.bio || 'No bio added yet.'}</p>

            <h4>Research Domain</h4>
            <p>{selectedProfile.research_domain || 'Not provided'}</p>

            <h4>Skills</h4>
            <div className="rm-interest-list">
              {(selectedProfile.skills || []).length ? (
                selectedProfile.skills.map((skill) => (
                  <span className="rm-interest-tag" key={skill}>
                    {skill}
                  </span>
                ))
              ) : (
                <p>No skills added.</p>
              )}
            </div>

            <h4>Projects</h4>
            <p>{selectedProfile.projects || 'Not provided'}</p>

            <h4>Publications</h4>
            <p>{selectedProfile.publications || 'Not provided'}</p>

            <h4>Availability</h4>
            <p>{selectedProfile.availability || 'Not specified'}</p>
          </div>
        </div>
      )}
    </div>
  )
}