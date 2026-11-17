// chess-pane.js — a chess game kept in a pod, played in the data browser.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Applies to a document that holds a chess:ChessGame. The game is one small file:
//
//   @prefix chess: <http://purl.org/NET/rdfchess/ontology/> .
//   @prefix schema: <http://schema.org/> .
//   <#game> a chess:ChessGame ; schema:name "First game" ; chess:hasSANRecord "e4 e5 Nf3" .
//
// The moves are the whole state (standard notation, space separated). Each move rewrites
// the file; everyone looking at the same address sees it within a couple of seconds
// (pushed by the pod where it offers live updates, otherwise by asking again).
//
// Two ways to play, chosen per viewer:
//   a person    whoever may write to the file may move, for whichever side is to move
//   computer    you take one colour, Stockfish (in your browser) answers for the other;
//               its moves are saved to the pod like yours
//
// Built from the same parts as Quiet Chess (github.com/solid-apps/stockfish), kept in
// ./chess/ beside this file and loaded the first time a board is drawn:
//   chessground (lichess.org, GPL-3.0)  board    Stockfish 18 lite, WASM (GPL-3.0)  engine
//   chess.js (Jeff Hlywa, BSD-2-Clause) rules    cburnett pieces (Colin M.L. Burnett)
//   board sounds (lichess-org/lila, AGPL-3.0)
const CHESS = 'http://purl.org/NET/rdfchess/ontology/'
const at = (file) => new URL('./chess/' + file, import.meta.url).href
const ICON = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#7a5230"><path d="M12 2a3.200 3.200 0 0 0-2.300 5.400L8.500 9H7v2h1.800c-.2 2.700-1 5-2.800 7h12c-1.800-2-2.600-4.300-2.800-7H17V9h-1.500l-1.200-1.600A3.200 3.200 0 0 0 12 2zM5 19.500V22h14v-2.500z"/></svg>')

const CSS = `
.chs { max-width: 980px; margin: 0 auto; padding: 28px 32px 96px; font: 15px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; color: #1d1d1f }
.chs-head { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; margin: 0 0 18px }
.chs-head h3 { margin: 0; font-size: 34px; font-weight: 700; letter-spacing: -.02em }
.chs-head span { color: #86868b }
.chs-main { display: flex; gap: 28px; flex-wrap: wrap; align-items: flex-start }
.chs-board { width: min(540px, 100%); aspect-ratio: 1; border-radius: 6px; overflow: hidden; box-shadow: 0 2px 10px rgba(60,40,10,.22) }
.chs-side { flex: 1; min-width: 240px; display: flex; flex-direction: column; gap: 12px }
.chs-status { font-size: 20px; font-weight: 650; margin: 0 }
.chs-note { color: #86868b; font-size: 13px; margin: -8px 0 0; min-height: 18px }
.chs-opts { display: grid; grid-template-columns: auto 1fr; gap: 8px 12px; align-items: center; background: #fff; border-radius: 12px; padding: 12px 14px; box-shadow: 0 1px 3px rgba(60,40,10,.14); font-size: 14px }
.chs-opts select, .chs-opts input { font: inherit; min-width: 0 }
.chs-opts select { border: 1px solid #d2d2d7; border-radius: 8px; padding: 3px 6px; background: #fff }
.chs-opts [hidden] { display: none }
.chs-moves { display: grid; grid-template-columns: 34px 1fr 1fr; gap: 3px 10px; font-size: 15px; max-height: 260px; overflow: auto; background: #fff; border-radius: 12px; padding: 12px 14px; box-shadow: 0 1px 3px rgba(60,40,10,.14) }
.chs-moves i { color: #86868b; font-style: normal }
.chs-moves:empty::before { content: "No moves yet."; grid-column: 1 / -1; color: #86868b }
.chs-btns { display: flex; gap: 8px; flex-wrap: wrap }
.chs-btns button { font: inherit; font-size: 14px; border: 1px solid #d2d2d7; background: #fff; border-radius: 999px; padding: 5px 14px; cursor: pointer }
.chs-btns button:hover { background: #f5f5f7 }
`

const sym = (uri) => globalThis.$rdf.sym(uri)
const TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'

function gameIn (subject, store) {
  const st = store.statementsMatching(null, sym(TYPE), sym(CHESS + 'ChessGame'), subject.doc())
  return st.length ? st[0].subject : null
}

function turtle (name, moves) {
  const q = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
  return `@prefix chess: <${CHESS}> .
@prefix schema: <http://schema.org/> .

<#game> a chess:ChessGame ;
    schema:name ${q(name)} ;
    chess:hasSANRecord ${q(moves.join(' '))} .
`
}

// The board, the rules and their stylesheets: fetched once, shared by every board on the page.
let parts
function loadParts (dom) {
  parts = parts || (async () => {
    const [cg, rules, ...sheets] = await Promise.all([
      import(at('chessground.min.js')), import(at('chess.js')),
      ...['chessground.base.css', 'chessground.brown.css', 'chessground.cburnett.css'].map(f => fetch(at(f)).then(r => r.text()))
    ])
    const style = dom.createElement('style'); style.textContent = sheets.join('\n'); dom.head.appendChild(style)
    return { Chessground: cg.Chessground, Chess: rules.Chess }
  })()
  return parts
}

// Stockfish in a worker. The engine script may live on another site than the page, so it
// is started from a small local script that pulls it in; it reads where its .wasm is from
// the part of its own address after the #.
class Engine {
  constructor () {
    const boot = URL.createObjectURL(new Blob([`importScripts(${JSON.stringify(at('stockfish-18-lite-single.js'))})`], { type: 'text/javascript' }))
    this.worker = new Worker(boot + '#' + encodeURIComponent(at('stockfish-18-lite-single.wasm')))
    this.waiting = []
    this.queue = Promise.resolve()
    this.worker.onmessage = (e) => {
      const line = typeof e.data === 'string' ? e.data : ''
      this.waiting = this.waiting.filter(w => { const m = line.match(w.re); if (m) w.done(m); return !m })
    }
    this.ready = new Promise((resolve, reject) => {
      this.waiting.push({ re: /^uciok$/, done: resolve })
      this.worker.addEventListener('error', () => reject(new Error('the engine did not load')))
      setTimeout(() => reject(new Error('the engine took too long to load')), 30000)
    }).then(() => this.send('setoption name UCI_LimitStrength value true'))
    this.send('uci')
  }

  send (cmd) { this.worker.postMessage(cmd) }
  move (fen, elo, ms) {
    const run = async () => {
      await this.ready
      const done = new Promise(resolve => this.waiting.push({ re: /^bestmove (\S+)/, done: resolve }))
      this.send('setoption name UCI_Elo value ' + elo)
      this.send('position fen ' + fen)
      this.send('go movetime ' + ms)
      return (await done)[1]
    }
    const p = this.queue.then(run); this.queue = p.catch(() => {}); return p
  }

  stop () { try { this.worker.terminate() } catch (e) {} }
}

export default {
  name: 'chess',
  icon: ICON,
  label (subject, context) {
    return gameIn(subject, context.session.store) ? 'Chess' : null
  },
  shouldGetFocus (subject) { return true },

  render (subject, context) {
    const dom = context.dom
    const store = context.session.store
    const url = subject.doc().uri
    const authed = store.fetcher && store.fetcher._fetch
    const web = authed ? (u, o) => store.fetcher._fetch(u, o) : (u, o) => fetch(u, o)
    const el = (tag, cls, text) => { const e = dom.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e }
    const KEY = 'chess-pane:' + url
    let prefs = { opponent: 'person', side: 'white', elo: 1600 }
    try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem(KEY) || '{}') } } catch (e) {}
    const keep = () => { try { localStorage.setItem(KEY, JSON.stringify(prefs)) } catch (e) {} }

    const root = el('div', 'chs')
    root.appendChild(el('style', null, CSS))
    const head = el('div', 'chs-head'); const title = el('h3', null, 'Chess'); const sub = el('span')
    head.append(title, sub)
    const main = el('div', 'chs-main'); const board = el('div', 'chs-board'); const side = el('div', 'chs-side')
    const status = el('p', 'chs-status', 'Setting up the board…'); const note = el('p', 'chs-note')
    const opts = el('div', 'chs-opts')
    const pick = (label, cls, choices, value) => {
      const s = el('select', cls); for (const [v, t] of choices) { const o = el('option', null, t); o.value = v; s.appendChild(o) }
      s.value = value; const l = el('label', null, label); opts.append(l, s); return [s, l]
    }
    const [oppS] = pick('Opponent', 'chs-opp', [['person', 'A person'], ['computer', 'Computer (Stockfish)']], prefs.opponent)
    const [sideS, sideL] = pick('You play', 'chs-you', [['white', 'White'], ['black', 'Black']], prefs.side)
    const eloL = el('label'); const eloI = el('input', 'chs-elo'); eloI.type = 'range'; eloI.min = 1320; eloI.max = 3190; eloI.step = 10; eloI.value = prefs.elo
    opts.append(eloL, eloI)
    const list = el('div', 'chs-moves'); const btns = el('div', 'chs-btns')
    const flipB = el('button', 'chs-flip', 'Flip board'); const newB = el('button', 'chs-new', 'New game')
    btns.append(flipB, newB); side.append(status, note, opts, list, btns); main.append(board, side); root.append(head, main)

    let Chess, ground, game, engine, name = 'Chess', moves = [], busy = false, thinking = false, etag = null, timer = null, ws = null, flipped = false, local = false
    const sounds = {}
    const sound = (n) => { try { const a = sounds[n] || (sounds[n] = new Audio(at(n + '.mp3'))); a.currentTime = 0; a.play().catch(() => {}) } catch (e) {} }
    const colour = (c) => c === 'w' ? 'white' : 'black'
    const vsComputer = () => prefs.opponent === 'computer'

    function replay (list) { const g = new Chess(); for (const m of list) g.move(m); return g }

    async function read () {
      const r = await web(url, { headers: { accept: 'text/turtle' }, cache: 'no-store' })
      if (!r.ok) throw new Error('could not read the game (' + r.status + ')')
      const tag = r.headers.get('etag'); const via = r.headers.get('updates-via')
      const g = globalThis.$rdf.graph()
      globalThis.$rdf.parse(await r.text(), g, url, 'text/turtle')
      const node = g.any(null, sym(TYPE), sym(CHESS + 'ChessGame'))
      if (!node) throw new Error('no chess game in this file')
      const rec = g.any(node, sym(CHESS + 'hasSANRecord')); const nm = g.any(node, sym('http://schema.org/name'))
      return { tag, via, name: nm ? nm.value : 'Chess', moves: rec && rec.value.trim() ? rec.value.trim().split(/\s+/) : [] }
    }

    async function refresh (quiet) {
      if (busy || (quiet && local)) return
      try {
        const got = await read()
        if (busy) return
        if (quiet && got.moves.join(' ') === moves.join(' ') && got.name === name) { etag = got.tag; return }
        const g = replay(got.moves)
        const grew = got.moves.length > moves.length
        etag = got.tag; name = got.name; moves = got.moves; game = g
        draw()
        if (quiet && grew) { const h = game.history({ verbose: true }); sound(h[h.length - 1].captured ? 'Capture' : 'Move') }
        if (got.via && !ws) listen(got.via)
        reply()
      } catch (e) { if (!quiet) { status.textContent = 'Could not open the game'; note.textContent = e.message } }
    }

    function listen (via) {
      try {
        ws = new WebSocket(via)
        ws.onopen = () => ws.send('sub ' + url)
        ws.onmessage = (m) => { if (String(m.data).startsWith('pub')) refresh(true) }
        ws.onclose = () => { ws = null }
      } catch (e) { ws = null }
    }

    // A game file that cannot be written (a static site, or no access) is still playable:
    // from the first refused move on, the game carries on in this window only.
    async function save (next, was) {
      if (local) return
      busy = true
      try {
        const now = await read()
        if (now.moves.join(' ') !== was.join(' ')) {
          if (now.moves.join(' ') === next.join(' ')) { etag = now.tag; note.textContent = ''; return }   // someone saved the same move
          throw new Error('the game changed in the meantime')
        }
        const r = await web(url, { method: 'PUT', headers: { 'content-type': 'text/turtle' }, body: turtle(name, next) })
        if (!r.ok) {
          local = true
          note.textContent = r.status === 401 || r.status === 403
            ? 'Playing in this window only: log in with an account that may write to this game to save moves.'
            : 'Playing in this window only: this game file cannot be changed.'
          return
        }
        etag = r.headers.get('etag')
        note.textContent = ''
      } catch (e) {
        if (e instanceof TypeError) {   // the write was not allowed to leave the browser
          local = true
          note.textContent = 'Playing in this window only: this game file cannot be changed.'
          return
        }
        note.textContent = 'Move not saved: ' + e.message + '.'
        busy = false
        await refresh(false)
      } finally { busy = false }
    }

    async function play (from, to) {
      const was = moves.slice()
      const done = game.move({ from, to, promotion: 'q' })
      moves = was.concat(done.san)
      sound(done.captured ? 'Capture' : 'Move'); if (game.isGameOver()) sound('GenericNotify')
      draw()
      await save(moves, was)
      reply()
    }

    // In computer mode, when it is the other colour's turn, ask the engine and play its move.
    async function reply () {
      if (!vsComputer() || !game || thinking || busy || game.isGameOver() || colour(game.turn()) === prefs.side) return
      thinking = true; draw()
      const fen = game.fen()
      try {
        engine = engine || new Engine()
        const best = await engine.move(fen, prefs.elo, 700)
        thinking = false
        if (vsComputer() && game.fen() === fen && best && best !== '(none)') await play(best.slice(0, 2), best.slice(2, 4))
        else draw()
      } catch (e) { thinking = false; note.textContent = 'Computer: ' + e.message + '.'; draw() }
    }

    function dests () {
      const d = new Map()
      for (const m of game.moves({ verbose: true })) d.set(m.from, (d.get(m.from) || []).concat(m.to))
      return d
    }

    function draw () {
      title.textContent = name
      sub.textContent = moves.length ? 'move ' + (Math.floor(moves.length / 2) + 1) : 'new game'
      const turn = colour(game.turn()); const Turn = turn === 'white' ? 'White' : 'Black'
      status.textContent = game.isCheckmate() ? 'Checkmate. ' + (turn === 'white' ? 'Black' : 'White') + ' wins.'
        : game.isGameOver() ? 'Draw.'
          : thinking ? 'Computer is thinking…'
            : Turn + ' to move' + (game.inCheck() ? ', in check' : '')
      sideS.hidden = sideL.hidden = eloL.hidden = eloI.hidden = !vsComputer()
      eloL.textContent = 'Strength ' + prefs.elo
      const hist = game.history({ verbose: true }); const last = hist[hist.length - 1]
      const mine = game.isGameOver() || thinking ? undefined : vsComputer() ? prefs.side : turn
      const want = (vsComputer() && prefs.side === 'black') !== flipped ? 'black' : 'white'
      ground.set({
        fen: game.fen(), orientation: want, turnColor: turn, check: game.inCheck(),
        lastMove: last ? [last.from, last.to] : undefined,
        movable: { color: mine, dests: dests() }
      })
      list.replaceChildren()
      for (let i = 0; i < moves.length; i += 2) list.append(el('i', null, (i / 2 + 1) + '.'), el('span', null, moves[i]), el('span', null, moves[i + 1] || ''))
      list.scrollTop = list.scrollHeight
    }

    flipB.addEventListener('click', () => { flipped = !flipped; if (game) draw() })
    newB.addEventListener('click', async () => {
      if (!game || busy) return
      const was = moves.slice(); moves = []; game = new Chess(); thinking = false
      draw(); await save(moves, was); reply()
    })
    oppS.addEventListener('change', () => { prefs.opponent = oppS.value; keep(); if (game) { draw(); reply() } })
    sideS.addEventListener('change', () => { prefs.side = sideS.value; keep(); if (game) { draw(); reply() } })
    eloI.addEventListener('input', () => { prefs.elo = Number(eloI.value); keep(); eloL.textContent = 'Strength ' + prefs.elo })

    const attached = () => new Promise(resolve => { const t = () => root.isConnected ? resolve() : setTimeout(t, 50); t() })
    Promise.all([loadParts(dom), attached()]).then(async ([p]) => {
      Chess = p.Chess
      game = new Chess()
      ground = p.Chessground(board, {
        fen: game.fen(), coordinates: true,
        movable: { free: false, color: undefined, showDests: true, events: { after: (from, to) => play(from, to) } },
        premovable: { enabled: false }, draggable: { showGhost: true }
      })
      // chessground remembers where the board is on the page. The data browser moves things
      // after the board is drawn (headings arrive late), so measure again at each press.
      board.addEventListener('pointerdown', () => ground.state.dom.bounds.clear(), true)
      await refresh(false)
      timer = setInterval(() => {
        if (!root.isConnected) { clearInterval(timer); if (ws) ws.close(); if (engine) engine.stop(); return }
        if (!ws) refresh(true)
      }, 2000)
    }).catch((e) => { status.textContent = 'Could not load the chess board'; note.textContent = e.message })

    return root
  }
}
