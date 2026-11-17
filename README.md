# chess pane

A chess game kept in a Solid pod, played in the SolidOS data browser. The pane is one ES module, loaded by link.

**Try it:** <https://mashlib.com/dynamic/?pane=https%3A%2F%2Fsolid-panes.github.io%2Fchess%2Fchess-pane.js&uri=https%3A%2F%2Fsolid-panes.github.io%2Fchess%2Fgames%2Fopera.ttl>

The link opens [mashlib dynamic](https://mashlib.com/dynamic/), which asks before it adds a pane from a site it has not
seen, then shows the game on a board. The game in the link is Morphy's Opera Game after nine moves, White to play.

## The data

A game is one small file. The moves are the whole state.

```turtle
@prefix chess: <http://purl.org/NET/rdfchess/ontology/> .
@prefix schema: <http://schema.org/> .

<#game> a chess:ChessGame ;
    schema:name "First game" ;
    chess:hasSANRecord "e4 e5 Nf3" .
```

Put a file like this in your pod (`games/new.ttl` is an empty one) and open it with the pane.

## Playing

- **A person.** Whoever may write to the file may move, for whichever side is to move. Each move rewrites the file,
  and everyone looking at the same address sees it within a couple of seconds.
- **The computer.** You take one colour and Stockfish, running in your browser, answers for the other. Its moves are
  saved like yours.
- **A file that cannot be written** (the examples here, which sit on a static site, or a game you have no access to)
  is still playable: the game carries on in your window only, and the pane says so.

Pawns promote to a queen.

## Using it

- By link, on mashlib dynamic: `https://mashlib.com/dynamic/?pane=https://solid-panes.github.io/chess/chess-pane.js&uri=<your game file>`
- On a JavaScript Solid Server: `jss start --mashlib-cdn --panes https://solid-panes.github.io/chess/chess-pane.js`
- In any SolidOS page: `panes.register((await import('https://solid-panes.github.io/chess/chess-pane.js')).default)`

## What it is made of

The pane is `chess-pane.js`. The parts in `chess/` are the same ones as [Quiet Chess](https://github.com/solid-apps/stockfish),
loaded the first time a board is drawn (the engine only when you choose the computer):

| Part | From | Licence |
|---|---|---|
| Board | [chessground](https://github.com/lichess-org/chessground), lichess.org | GPL-3.0 |
| Engine | [Stockfish](https://github.com/official-stockfish/Stockfish) 18 lite, WASM | GPL-3.0 |
| Rules | [chess.js](https://github.com/jhlywa/chess.js), Jeff Hlywa | BSD-2-Clause |
| Pieces | cburnett set, Colin M.L. Burnett | CC-BY-SA 3.0 / GFDL |
| Sounds | [lichess-org/lila](https://github.com/lichess-org/lila) | AGPL-3.0 |

The pane itself is [GPL-3.0](LICENSE).
