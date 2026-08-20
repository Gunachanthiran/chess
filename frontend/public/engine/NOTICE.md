# Engine Asset Compliance

ChessScope uses Stockfish 18.0.8 lite-single for browser-side "explore" position
previews (the analysis page's drag-any-move live eval). Stockfish.js and Stockfish
are GPLv3 software. This directory holds the engine files served by ChessScope.

## Distributed engine files

- `stockfish-18-lite-single.js`
- `stockfish-18-lite-single.wasm`

Both are served unmodified from the official
[`stockfish`](https://www.npmjs.com/package/stockfish) npm package, version
`18.0.8` (`node_modules/stockfish/bin/`) — itself
[Stockfish.js](https://github.com/nmrugg/stockfish.js) by Nathan Rugg, based on
[Stockfish](https://github.com/official-stockfish/Stockfish).

## License and source

- License: [GPLv3](./GPLv3-LICENSE.txt)
- Upstream source: https://github.com/nmrugg/stockfish.js
- Package used: https://www.npmjs.com/package/stockfish/v/18.0.8

Real game analysis (the pipeline behind the move-by-move review, accuracy, and
classifications) is unrelated to this — that stays server-side Stockfish, run by
the backend. This engine is only ever used for the live "what if I play this"
preview on the analysis board.
