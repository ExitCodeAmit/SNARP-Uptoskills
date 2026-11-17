import { useLayoutEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { ScrollSmoother } from 'gsap/ScrollSmoother'
import { SplitText } from 'gsap/SplitText'
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin'
import { Flip } from 'gsap/Flip'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowRight02Icon, Image02Icon, CheckmarkBadge01Icon, Tick02Icon, Copy01Icon, Message01Icon,
  Calendar03Icon, Comment01Icon, Mail01Icon, Call02Icon, Location01Icon, UserAdd01Icon,
  PencilEdit02Icon, QuoteDownIcon,
} from '@hugeicons/core-free-icons'
import { initials } from './format'
import { apa, bibtex } from './cite'
import { ARTICLES } from './sample'
import logo from './assets/logo.png'
import './Landing.css'

gsap.registerPlugin(ScrollTrigger, ScrollSmoother, SplitText, DrawSVGPlugin, Flip)

const Icon = ({ icon, size = 22 }) => <HugeiconsIcon icon={icon} size={size} strokeWidth={1.8} />

/* ---------- Content ---------- */

const ROTATOR = [
  { text: 'readers.', bg: '#c2481a', fg: '#ffffff' },
  { text: 'peers.', bg: '#0f7666', fg: '#ffffff' },
  { text: 'reviewers.', bg: '#355fb5', fg: '#ffffff' },
  { text: 'citations.', bg: '#fabb17', fg: '#17212f' },
]

const MARQUEE = ['Post updates', 'Publish papers', 'Get reviewed', 'Join communities', 'Cite instantly', 'Message peers']

const PAPER = ARTICLES[1]
const APA_TEXT = apa(PAPER)
const BIB_TEXT = bibtex(PAPER)

const COMMUNITIES = [
  ['AI', 'orange', true], ['UI/UX', 'teal'], ['Education', 'blue'], ['Marketing', 'yellow'], ['Systems', 'teal', true],
  ['Open Source', 'orange'], ['Data Science', 'blue'], ['Creative', 'yellow'], ['Accessibility', 'teal'],
]

const NOTIFS = [
  { icon: Message01Icon, tone: 'teal', title: 'Asha Sen', text: 'Your peer review notes are ready.', time: 'now' },
  { icon: CheckmarkBadge01Icon, tone: 'orange', title: 'Paper approved', text: 'Lightweight Transformers is now public.', time: '2m' },
  { icon: Calendar03Icon, tone: 'yellow', title: 'Event tomorrow', text: 'Writing Your First Research Paper, 5 PM', time: '1h' },
  { icon: Comment01Icon, tone: 'blue', title: 'Rahul Das', text: 'commented on your post.', time: '3h' },
]

const FEATURES = [
  {
    tone: 'orange',
    visual: 'photos',
    title: 'Post with photos.',
    body: 'Share a poster, a lab photo or a quick finding. Write a description and it lands in everyone’s feed.',
    pills: ['JPEG, PNG, GIF, WebP', 'Up to 5 MB', 'Stored in PostgreSQL'],
  },
  {
    tone: 'teal',
    visual: 'paper',
    title: 'Publish reviewed papers.',
    body: 'Submit the title, abstract, DOI and co-authors. Moderators approve each paper before it goes public.',
    pills: ['PDF uploads', 'Moderator review', 'Searchable by tag'],
  },
  {
    tone: 'blue',
    visual: 'communities',
    title: 'Find your people.',
    body: 'Join communities in AI, UI/UX, Education and more, and follow what your peers are building.',
    pills: ['Join in one tap', 'Community feeds', 'Peer discussions'],
  },
  {
    tone: 'yellow',
    visual: 'cite',
    title: 'Cite in one click.',
    body: 'APA and BibTeX from a paper’s details. Missing fields are left out, never invented.',
    pills: ['APA', 'BibTeX', 'Copy to clipboard'],
  },
  {
    tone: 'ink',
    visual: 'notifs',
    title: 'Stay in the loop.',
    body: 'Messages, review alerts and event reminders arrive in one place, the moment they happen.',
    pills: ['Direct messages', 'Review alerts', 'Event reminders'],
  },
]

const STEPS = [
  { verb: 'Sign up.', tone: 'orange', icon: UserAdd01Icon, text: 'Create an account in under a minute. Choose to read and discuss, or to publish research.' },
  { verb: 'Share.', tone: 'teal', icon: PencilEdit02Icon, text: 'Post updates with photos, or submit a paper with its abstract, DOI and co-authors.' },
  { verb: 'Get reviewed.', tone: 'blue', icon: CheckmarkBadge01Icon, text: 'Moderators check every paper before it goes public, so the feed stays trustworthy.' },
  { verb: 'Get cited.', tone: 'ink', icon: QuoteDownIcon, text: 'Peers find your work through search and communities, then read it and cite it.' },
]

/* ---------- Research network (hero visual) ---------- */

const C = { x: 280, y: 280 }
const polar = (r, deg) => ({ x: C.x + r * Math.cos((deg * Math.PI) / 180), y: C.y + r * Math.sin((deg * Math.PI) / 180) })

const RING = [
  { name: 'Asha Sen', deg: -95, r: 170, tone: 'orange', label: 'read it' },
  { name: 'Vikram Rao', deg: -45, r: 186, tone: 'teal', label: 'liked' },
  { name: 'Priya Menon', deg: 0, r: 166, tone: 'blue', label: 'cited you' },
  { name: 'Rahul Das', deg: 45, r: 186, tone: 'yellow', label: 'replied' },
  { name: 'Neha Iyer', deg: 92, r: 172, tone: 'ink', label: 'shared' },
  { name: 'Arjun Shah', deg: 138, r: 182, tone: 'orange', label: 'joined' },
  { name: 'Sara Khan', deg: 182, r: 168, tone: 'teal', label: 'saved' },
  { name: 'Dev Patel', deg: 228, r: 184, tone: 'blue', label: 'approved' },
].map((n) => ({ ...n, ...polar(n.r, n.deg) }))

const OUTER = [-120, -70, -22, 22, 68, 115, 160, 205, 250].map((deg, i) => ({
  deg,
  tone: ['orange', 'teal', 'blue', 'yellow'][i % 4],
  ...polar(252, deg),
}))

const angleGap = (a, b) => Math.abs((((a - b) % 360) + 540) % 360 - 180)
const EDGES = [
  ...RING.map((n) => [C, n]),
  ...OUTER.map((o) => [RING.reduce((best, n) => (angleGap(n.deg, o.deg) < angleGap(best.deg, o.deg) ? n : best)), o]),
  [RING[1], RING[3]],
  [RING[5], RING[7]],
]

// Packets: "out" = your work reaching a peer, "in" = a peer citing you back
const TRIPS = [[0, 'out'], [2, 'out'], [5, 'in'], [3, 'out'], [7, 'out'], [1, 'in'], [4, 'out'], [6, 'out'], [2, 'in'], [5, 'out']]

function NetworkGraph() {
  return (
    <svg className="graph" viewBox="0 0 560 560" role="img" aria-label="Your research reaching a network of peers">
      <circle className="g-guide g-guide-1" cx={C.x} cy={C.y} r="176" />
      <circle className="g-guide g-guide-2" cx={C.x} cy={C.y} r="252" />
      {EDGES.map(([a, b], i) => (
        <line key={i} className="g-edge" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
      ))}
      {OUTER.map((o, i) => (
        <circle key={i} className={`g-dot d-${o.tone}`} cx={o.x} cy={o.y} r={i % 3 ? 8 : 11} />
      ))}
      <circle className="g-halo" cx={C.x} cy={C.y} r="78" />
      <g className="g-center">
        <circle className="g-center-core" cx={C.x} cy={C.y} r="54" />
        <text x={C.x} y={C.y + 7} textAnchor="middle" className="g-center-text">You</text>
      </g>
      {RING.map((n) => (
        <g key={n.name} className={`g-node n-${n.tone}`}>
          <circle cx={n.x} cy={n.y} r="27" />
          <text x={n.x} y={n.y + 5} textAnchor="middle">{initials(n.name)}</text>
        </g>
      ))}
      {TRIPS.map(([, dir], k) => (
        <circle key={k} className={`g-packet p-${dir}`} r="6.5" cx={C.x} cy={C.y} opacity="0" />
      ))}
      {RING.map((n) => {
        const w = 18 + n.label.length * 7.4
        return (
          <g key={n.name} className="g-label" opacity="0">
            <rect x={n.x - w / 2} y={n.y - 66} width={w} height="27" rx="13.5" />
            <text x={n.x} y={n.y - 48} textAnchor="middle">{n.label}</text>
          </g>
        )
      })}
      <g className="g-label g-center-label" opacity="0">
        <rect x={C.x - 62} y={C.y - 98} width="124" height="27" rx="13.5" />
        <text x={C.x} y={C.y - 80} textAnchor="middle">+1 citation</text>
      </g>
    </svg>
  )
}

/* ---------- Feature card visuals ---------- */

function Visual({ kind }) {
  if (kind === 'photos') {
    return (
      <div className="v-photos" aria-hidden="true">
        <figure className="polaroid pol-1"><span className="ph ph-teal"><Icon icon={Image02Icon} size={44} /></span></figure>
        <figure className="polaroid pol-2"><span className="ph ph-blue"><Icon icon={Image02Icon} size={44} /></span></figure>
        <figure className="polaroid pol-3">
          <span className="ph ph-yellow"><Icon icon={Image02Icon} size={44} /></span>
          <figcaption>Our poster for the innovation challenge</figcaption>
        </figure>
        <span className="posted"><Icon icon={Tick02Icon} size={18} /> Posted to your feed</span>
      </div>
    )
  }
  if (kind === 'paper') {
    return (
      <div className="v-paper" aria-hidden="true">
        <div className="sheet sheet-back" />
        <article className="sheet sheet-front">
          <span className="sheet-kicker">Research paper</span>
          <h4>{PAPER.title}</h4>
          <p className="sheet-authors">{PAPER.authors.join(', ')}</p>
          <p className="sheet-abstract">{PAPER.abstract}</p>
          <div className="sheet-tags">{PAPER.tags.map((t) => <span key={t}>#{t}</span>)}</div>
        </article>
        <span className="stamp"><Icon icon={CheckmarkBadge01Icon} size={20} /> Approved</span>
      </div>
    )
  }
  if (kind === 'communities') {
    return (
      <div className="v-chips" aria-hidden="true">
        {COMMUNITIES.map(([name, tone, joined]) => (
          <span key={name} className={`cchip ${joined ? 'joined' : ''}`}>
            <span className={`cchip-ini ini-${tone}`}>{name[0]}</span>
            {name}
          </span>
        ))}
      </div>
    )
  }
  if (kind === 'cite') {
    return (
      <div className="v-cite" aria-hidden="true">
        <div className="cite-head">
          <span className="ct active">APA</span>
          <span className="ct">BibTeX</span>
          <span className="cite-copy"><Icon icon={Copy01Icon} size={16} /> Copy</span>
        </div>
        <pre className="cite-out">{APA_TEXT}</pre>
      </div>
    )
  }
  return (
    <div className="v-notifs" aria-hidden="true">
      {NOTIFS.map((n) => (
        <div key={n.title} className="nt">
          <span className={`nt-icon nt-${n.tone}`}><Icon icon={n.icon} size={20} /></span>
          <div className="nt-text">
            <strong>{n.title}</strong>
            <p>{n.text}</p>
          </div>
          <time>{n.time}</time>
        </div>
      ))}
    </div>
  )
}

/* ---------- Page ---------- */

export default function Landing() {
  const root = useRef(null)
  const wrapper = useRef(null)
  const content = useRef(null)

  // Anchor links scroll through the smoother when it is active
  const go = (e, id) => {
    e.preventDefault()
    const el = document.getElementById(id)
    const smoother = ScrollSmoother.get()
    if (smoother) smoother.scrollTo(el, true, 'top 80px')
    else el.scrollIntoView({ behavior: 'smooth' })
  }

  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      const mm = gsap.matchMedia()

      // Content is fully visible without JS; everything below only runs when motion is allowed
      mm.add(
        {
          motion: '(prefers-reduced-motion: no-preference)',
          wide: '(min-width: 960px)',
          fine: '(hover: hover) and (pointer: fine)',
        },
        (mctx) => {
          const { motion, wide, fine } = mctx.conditions
          if (!motion) return

          const q = (sel) => root.current.querySelector(sel)
          const cleanups = []
          const splits = []
          const on = (el, type, fn) => {
            el.addEventListener(type, fn)
            cleanups.push(() => el.removeEventListener(type, fn))
          }
          const split = (target, vars) => {
            const s = SplitText.create(target, vars)
            splits.push(s)
            return s
          }

          // Smooth scrolling must exist before any other ScrollTrigger
          const smoother = ScrollSmoother.create({ wrapper: wrapper.current, content: content.current, smooth: 1.15, effects: true, smoothTouch: false })
          cleanups.push(() => smoother.kill())

          // Nav hides while scrolling down, returns on the way up
          const nav = q('.l-nav')
          ScrollTrigger.create({
            start: 140,
            end: 'max',
            onUpdate: (self) => nav.classList.toggle('is-hidden', self.direction === 1),
            onLeaveBack: () => nav.classList.remove('is-hidden'),
          })
          cleanups.push(() => nav.classList.remove('is-hidden'))

          /* Hero entrance */
          const title = split('.hero-title .hl', { type: 'words,chars', mask: 'words' })
          gsap.set(['.g-node', '.g-center', '.g-dot'], { transformOrigin: '50% 50%' })
          gsap.timeline({ defaults: { ease: 'expo.out' } })
            .from(title.chars, { yPercent: 115, duration: 1.1, stagger: 0.02 })
            .from('.rotator', { scaleX: 0, transformOrigin: 'left center', duration: 1 }, 0.5)
            .from('.hero-sub, .hero-ctas', { y: 30, opacity: 0, duration: 1, stagger: 0.12 }, 0.7)
            .from('.g-guide', { scale: 0.5, opacity: 0, svgOrigin: `${C.x} ${C.y}`, duration: 1.6 }, 0.2)
            .from('.g-center', { scale: 0, duration: 1, ease: 'back.out(1.8)' }, 0.3)
            .from('.g-halo', { scale: 0, svgOrigin: `${C.x} ${C.y}`, duration: 1.2 }, 0.4)
            .from('.g-edge', { drawSVG: 0, duration: 1.1, stagger: 0.025, ease: 'power2.inOut' }, 0.5)
            .from('.g-node', { scale: 0, duration: 0.8, stagger: 0.06, ease: 'back.out(2.2)' }, 0.8)
            .from('.g-dot', { scale: 0, duration: 0.6, stagger: 0.04, ease: 'back.out(2.2)' }, 1.1)

          gsap.to('.g-guide-1', { rotation: 360, svgOrigin: `${C.x} ${C.y}`, duration: 80, repeat: -1, ease: 'none' })
          gsap.to('.g-guide-2', { rotation: -360, svgOrigin: `${C.x} ${C.y}`, duration: 120, repeat: -1, ease: 'none' })
          gsap.to('.g-halo', { scale: 1.12, svgOrigin: `${C.x} ${C.y}`, duration: 1.8, repeat: -1, yoyo: true, ease: 'sine.inOut', delay: 1.6 })

          // Packets travel the network on a loop; arrivals pulse the node and show what happened
          const packets = gsap.utils.toArray('.g-packet')
          const nodes = gsap.utils.toArray('.g-node')
          const labels = gsap.utils.toArray('.g-label:not(.g-center-label)')
          const traffic = gsap.timeline({ repeat: -1, delay: 2.2, repeatDelay: 0.6 })
          TRIPS.forEach(([i, dir], k) => {
            const at = k * 0.85
            const out = dir === 'out'
            const [from, to] = out ? [C, RING[i]] : [RING[i], C]
            const target = out ? nodes[i] : q('.g-center')
            const label = out ? labels[i] : q('.g-center-label')
            traffic
              .set(packets[k], { attr: { cx: from.x, cy: from.y }, opacity: 1 }, at)
              .to(packets[k], { attr: { cx: to.x, cy: to.y }, duration: 0.9, ease: 'power2.inOut' }, at)
              .set(packets[k], { opacity: 0 }, at + 0.9)
              .to(target, { scale: 1.18, duration: 0.18, yoyo: true, repeat: 1, ease: 'power2.out' }, at + 0.9)
              .fromTo(label, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.35, ease: 'back.out(2)' }, at + 0.9)
              .to(label, { opacity: 0, y: -8, duration: 0.3 }, at + 2.2)
          })

          // Rotating word: measure once fonts are in, then morph width and colour per word
          let alive = true
          cleanups.push(() => { alive = false })
          document.fonts.ready.then(() => {
            if (!alive) return
            mctx.add(() => {
              const rot = q('.rotator')
              const words = gsap.utils.toArray('.rw')
              gsap.set(words, { display: 'block' })
              const cs = getComputedStyle(rot)
              const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)
              const widths = words.map((w) => w.offsetWidth + pad)
              gsap.set(rot, { width: widths[0] })
              gsap.set(words.slice(1), { yPercent: 115 })
              const tl = gsap.timeline({ repeat: -1, delay: 1.4 })
              words.forEach((w, i) => {
                const next = (i + 1) % words.length
                tl.to(rot, { width: widths[next], backgroundColor: ROTATOR[next].bg, duration: 0.75, ease: 'expo.inOut' }, '+=1.9')
                  .to(w, { yPercent: -115, duration: 0.75, ease: 'expo.inOut' }, '<')
                  // immediateRender off, or the final step (back to word 0) would hide word 0 at build time
                  .fromTo(words[next], { yPercent: 115 }, { yPercent: 0, duration: 0.75, ease: 'expo.inOut', immediateRender: false }, '<')
              })
            })
          })

          // Graph tilts toward the pointer
          if (fine) {
            const hero = q('.hero')
            const tilt = q('.graph-tilt')
            const rx = gsap.quickTo(tilt, 'rotationX', { duration: 0.9, ease: 'power3.out' })
            const ry = gsap.quickTo(tilt, 'rotationY', { duration: 0.9, ease: 'power3.out' })
            on(hero, 'pointermove', (e) => {
              const r = hero.getBoundingClientRect()
              ry(((e.clientX - r.left) / r.width - 0.5) * 16)
              rx(-((e.clientY - r.top) / r.height - 0.5) * 12)
            })
            on(hero, 'pointerleave', () => { rx(0); ry(0) })
          }

          /* Marquee: constant drift, speeds up and leans with scroll velocity */
          const drift = gsap.to('.mq-track', { xPercent: -50, ease: 'none', duration: 34, repeat: -1 })
          const lean = gsap.quickTo('.mq-skew', 'skewX', { duration: 0.5, ease: 'power3.out' })
          ScrollTrigger.create({
            trigger: '.mq',
            start: 'top bottom',
            end: 'bottom top',
            onUpdate: (self) => {
              const v = self.getVelocity()
              lean(gsap.utils.clamp(-14, 14, v / -220))
              gsap.to(drift, { timeScale: gsap.utils.clamp(1, 6, 1 + Math.abs(v) / 350), duration: 0.2, overwrite: true })
              gsap.to(drift, { timeScale: 1, duration: 1.2, delay: 0.25 })
              gsap.delayedCall(0.25, () => lean(0))
            },
          })

          /* Section headings rise line by line */
          gsap.utils.toArray('.split-lines').forEach((el) => {
            const s = split(el, { type: 'lines', mask: 'lines' })
            gsap.from(s.lines, { yPercent: 105, duration: 1.1, stagger: 0.1, ease: 'expo.out', scrollTrigger: { trigger: el, start: 'top 86%', once: true } })
          })
          gsap.utils.toArray('.fade-up').forEach((el) => {
            gsap.from(el, { y: 30, opacity: 0, duration: 1, ease: 'expo.out', scrollTrigger: { trigger: el, start: 'top 88%', once: true } })
          })

          /* Feature cards: pinned stack on desktop, each new card buries the last */
          const cards = gsap.utils.toArray('.stack-card')
          if (wide) {
            const last = cards[cards.length - 1]
            cards.forEach((card, i) => {
              if (card === last) return
              ScrollTrigger.create({ trigger: card, start: 'top 92px', endTrigger: last, end: 'top 92px', pin: true, pinSpacing: false })
              gsap.to(card.querySelector('.stack-inner'), {
                scale: 0.9,
                '--dim': 0.38,
                ease: 'none',
                scrollTrigger: { trigger: cards[i + 1], start: 'top bottom', end: 'top 92px', scrub: true },
              })
            })
          } else {
            cards.forEach((card) => gsap.from(card, { y: 60, opacity: 0, duration: 1, ease: 'expo.out', scrollTrigger: { trigger: card, start: 'top 88%', once: true } }))
          }

          const once = (sel, build) => build(gsap.timeline({ scrollTrigger: { trigger: q(sel), start: 'top 62%', once: true } }))
          const whileVisible = (sel, tl) => ScrollTrigger.create({ trigger: q(sel), start: 'top 75%', end: 'bottom 15%', onToggle: (self) => (self.isActive ? tl.play() : tl.pause()) })

          once('.v-photos', (tl) =>
            tl.from('.polaroid', { y: 280, rotation: (i) => [-34, 24, -18][i], opacity: 0, duration: 1.1, stagger: 0.14, ease: 'back.out(1.3)' })
              .from('.posted', { y: 24, opacity: 0, scale: 0.85, duration: 0.6, ease: 'back.out(2.2)' }, '-=0.3')
          )

          once('.v-paper', (tl) =>
            tl.from('.sheet-front', { y: 90, rotation: -10, opacity: 0, duration: 1, ease: 'expo.out' })
              .from('.sheet-back', { rotation: 0, opacity: 0, duration: 0.8, ease: 'expo.out' }, '<0.15')
              .from('.stamp', { scale: 3.2, rotation: -45, opacity: 0, duration: 0.5, ease: 'back.out(2.6)' }, '+=0.15')
              .to('.sheet-front', { x: 7, duration: 0.05, yoyo: true, repeat: 5 }, '<0.3')
          )

          // Community chips reshuffle with FLIP while the card is on screen
          const chips = gsap.utils.toArray('.cchip')
          const shuffle = () => {
            const state = Flip.getState(chips)
            const order = gsap.utils.shuffle(chips.map((_, i) => i))
            chips.forEach((c, i) => { c.style.order = order[i] })
            chips[Math.floor(Math.random() * chips.length)].classList.toggle('joined')
            Flip.from(state, { duration: 0.9, ease: 'expo.inOut', stagger: 0.015 })
          }
          once('.v-chips', (tl) => tl.from(chips, { scale: 0, opacity: 0, duration: 0.6, stagger: 0.05, ease: 'back.out(2.2)' }))
          const chipLoop = gsap.timeline({ repeat: -1, paused: true }).call(shuffle, null, 1.8).to({}, { duration: 1.6 })
          whileVisible('.v-chips', chipLoop)
          cleanups.push(() => chips.forEach((c) => { c.style.order = '' }))

          // Citation types itself out in APA, then BibTeX
          const out = q('.cite-out')
          const tabs = gsap.utils.toArray('.ct')
          const setTab = (i) => tabs.forEach((t, j) => t.classList.toggle('active', i === j))
          const typer = (text, duration) => {
            const p = { n: 0 }
            return gsap.to(p, { n: text.length, duration, ease: 'none', onUpdate: () => { out.textContent = text.slice(0, Math.round(p.n)) } })
          }
          const citeLoop = gsap.timeline({ repeat: -1, repeatDelay: 1.2, paused: true })
            .call(() => { setTab(0); out.textContent = '' })
            .add(typer(APA_TEXT, 2.2))
            .call(() => { setTab(1); out.textContent = '' }, null, '+=1.8')
            .add(typer(BIB_TEXT, 2.6))
            .to({}, { duration: 2 })
          whileVisible('.v-cite', citeLoop)
          cleanups.push(() => { out.textContent = APA_TEXT; setTab(0) })

          // Notifications drop in one after another, then clear
          const notifLoop = gsap.timeline({ repeat: -1, repeatDelay: 0.3, paused: true })
            .from('.nt', { y: -44, opacity: 0, scale: 0.94, duration: 0.7, stagger: 0.55, ease: 'expo.out' })
            .to('.nt', { y: 18, opacity: 0, duration: 0.45, stagger: 0.07, ease: 'power2.in' }, '+=2.4')
          whileVisible('.v-notifs', notifLoop)

          /* How it works: horizontal pan on desktop, giant verbs rise as each panel arrives */
          const verbs = gsap.utils.toArray('.jp-verb')
          if (wide) {
            const journey = q('.journey')
            const track = q('.journey-track')
            journey.classList.add('is-pan')
            cleanups.push(() => journey.classList.remove('is-pan'))
            const distance = () => track.scrollWidth - window.innerWidth
            const pan = gsap.to(track, {
              x: () => -distance(),
              ease: 'none',
              scrollTrigger: { trigger: journey, start: 'top top', end: () => `+=${distance()}`, pin: true, scrub: 1, invalidateOnRefresh: true },
            })
            verbs.forEach((el) => {
              const s = split(el, { type: 'chars', mask: 'chars' })
              gsap.from(s.chars, {
                yPercent: 115,
                stagger: 0.035,
                duration: 0.8,
                ease: 'expo.out',
                scrollTrigger: { trigger: el, containerAnimation: pan, start: 'left 82%', toggleActions: 'play none none reverse' },
              })
            })
          } else {
            verbs.forEach((el) => {
              const s = split(el, { type: 'chars', mask: 'chars' })
              gsap.from(s.chars, { yPercent: 115, stagger: 0.03, duration: 0.8, ease: 'expo.out', scrollTrigger: { trigger: el, start: 'top 85%', once: true } })
            })
          }

          /* Statement fills in word by word with the scroll */
          const statement = split('.statement p', { type: 'words' })
          gsap.from(statement.words, {
            opacity: 0.12,
            stagger: 0.1,
            ease: 'none',
            scrollTrigger: { trigger: '.statement', start: 'top 78%', end: 'bottom 60%', scrub: true },
          })

          /* Footer wordmark rises letter by letter */
          const mark = split('.l-wordmark', { type: 'chars', mask: 'chars' })
          gsap.from(mark.chars, { yPercent: 100, stagger: 0.06, duration: 1.2, ease: 'expo.out', scrollTrigger: { trigger: '.l-wordmark', start: 'top 98%', once: true } })

          /* Magnetic buttons */
          if (fine) {
            gsap.utils.toArray('.magnetic').forEach((btn) => {
              const x = gsap.quickTo(btn, 'x', { duration: 0.6, ease: 'elastic.out(1, 0.45)' })
              const y = gsap.quickTo(btn, 'y', { duration: 0.6, ease: 'elastic.out(1, 0.45)' })
              on(btn, 'pointermove', (e) => {
                const r = btn.getBoundingClientRect()
                x((e.clientX - (r.left + r.width / 2)) * 0.35)
                y((e.clientY - (r.top + r.height / 2)) * 0.35)
              })
              on(btn, 'pointerleave', () => { x(0); y(0) })
            })
          }

          return () => {
            cleanups.forEach((fn) => fn())
            splits.forEach((s) => s.revert())
          }
        }
      )
    }, root)

    // Webfont swap changes line heights; recalculate trigger positions once it lands
    document.fonts?.ready.then(() => ScrollTrigger.refresh())
    return () => ctx.revert()
  }, [])

  return (
    <div className="landing" ref={root}>
      <header className="l-nav">
        <Link to="/" className="l-nav-logo"><img src={logo} alt="UptoSkills" /></Link>
        <nav className="l-links" aria-label="Sections">
          <a href="#features" onClick={(e) => go(e, 'features')}>Features</a>
          <a href="#how" onClick={(e) => go(e, 'how')}>How it works</a>
        </nav>
        <div className="l-nav-ctas">
          <Link to="/login" className="l-login">Log in</Link>
          <Link to="/chat" className="l-login">Try chat</Link>
          <Link to="/signup" className="btn btn-primary l-pill">Create account</Link>
        </div>
      </header>

      <div ref={wrapper} className="smooth-wrapper">
        <div ref={content} className="smooth-content">
          <section className="hero">
            <div className="l-wrap hero-inner">
              <h1 className="hero-title">
                <span className="hl">Where research finds its</span>
                <span className="hl-row">
                  <span className="rotator" aria-hidden="true">
                    {ROTATOR.map((w) => (
                      <span key={w.text} className="rw" style={{ color: w.fg }}>{w.text}</span>
                    ))}
                  </span>
                  <span className="sr-only">readers.</span>
                </span>
              </h1>
              <p className="hero-sub">
                Post updates, publish peer-reviewed papers and grow with communities of students and researchers.
              </p>
              <div className="hero-ctas">
                <Link to="/signup" className="btn btn-primary l-btn-xl magnetic">
                  Create account <Icon icon={ArrowRight02Icon} size={20} />
                </Link>
                <Link to="/login" className="btn btn-ghost l-btn-xl">Log in</Link>
              </div>
              <div className="hero-visual" data-speed="0.88">
                <div className="graph-tilt">
                  <NetworkGraph />
                </div>
              </div>
            </div>
          </section>

          <section className="mq" aria-hidden="true">
            <div className="mq-skew">
              <div className="mq-track">
                {[...MARQUEE, ...MARQUEE].map((w, i) => (
                  <span key={i} className={`mq-item ${i % 2 ? 'mq-outline' : ''}`}>
                    {w}
                    <span className={`mq-star star-${['orange', 'teal', 'blue', 'yellow'][i % 4]}`} />
                  </span>
                ))}
              </div>
            </div>
          </section>

          <section id="features" className="features">
            <div className="l-wrap">
              <div className="features-head">
                <h2 className="l-h2 split-lines">Share it. Publish it. Get it cited.</h2>
                <p className="l-lead fade-up">Five tools that take your work from a first post to a first citation.</p>
              </div>
              <div className="stack">
                {FEATURES.map((f, i) => (
                  <article key={f.title} className="stack-card" style={{ zIndex: i + 1 }}>
                    <div className={`stack-inner sc-${f.tone}`}>
                      <div className="sc-text">
                        <h3>{f.title}</h3>
                        <p>{f.body}</p>
                        <ul className="sc-pills">
                          {f.pills.map((p) => <li key={p}>{p}</li>)}
                        </ul>
                      </div>
                      <div className="sc-visual">
                        <Visual kind={f.visual} />
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </section>

          <section id="how" className="journey">
            <div className="journey-track">
              <div className="jp jp-intro">
                <h2 className="l-h2">From first post to first citation.</h2>
                <p className="l-lead">Four steps, and you are part of the conversation.</p>
              </div>
              {STEPS.map((s) => (
                <div key={s.verb} className="jp">
                  <span className={`jp-icon jp-${s.tone}`}><Icon icon={s.icon} size={30} /></span>
                  <span className={`jp-verb verb-${s.tone}`}>{s.verb}</span>
                  <p>{s.text}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="statement">
            <div className="l-wrap">
              <p>
                Good research should not disappear in a folder. SNARP makes sure it gets{' '}
                <span className="key key-o">seen</span>, <span className="key key-t">read</span> and{' '}
                <span className="key key-b">cited</span>.
              </p>
            </div>
          </section>

          <section className="cta">
            <div className="l-wrap cta-inner">
              <h2 className="split-lines">Your work deserves <span className="cta-mark">readers.</span></h2>
              <div className="cta-side fade-up">
                <p>Create an account and share your first post today.</p>
                <div className="hero-ctas">
                  <Link to="/signup" className="btn btn-primary l-btn-xl magnetic">
                    Create account <Icon icon={ArrowRight02Icon} size={20} />
                  </Link>
                  <Link to="/login" className="btn btn-ghost l-btn-xl">Log in</Link>
                </div>
              </div>
            </div>
          </section>

          <footer className="l-footer">
            <div className="l-wrap l-footer-grid">
              <div className="l-footer-brand">
                <img src={logo} alt="UptoSkills" />
                <p>Social Networking and Academic Research Platform, built at UptoSkills.</p>
              </div>
              <nav className="l-footer-col" aria-label="Platform">
                <h3>Platform</h3>
                <a href="#features" onClick={(e) => go(e, 'features')}>Features</a>
                <a href="#how" onClick={(e) => go(e, 'how')}>How it works</a>
                <Link to="/login">Log in</Link>
                <Link to="/signup">Create account</Link>
              </nav>
              <div className="l-footer-col">
                <h3>Contact</h3>
                <a href="mailto:info@uptoskills.com"><Icon icon={Mail01Icon} size={18} /> info@uptoskills.com</a>
                <a href="tel:+919319772294"><Icon icon={Call02Icon} size={18} /> +91 93197 72294</a>
                <span><Icon icon={Location01Icon} size={18} /> Palam, New Delhi, India</span>
              </div>
            </div>
            <div className="l-wrap l-copy">© {new Date().getFullYear()} UptoSkills. All rights reserved.</div>
            <div className="l-wordmark" aria-hidden="true">SNARP</div>
          </footer>
        </div>
      </div>
    </div>
  )
}
