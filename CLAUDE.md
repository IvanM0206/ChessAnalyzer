# Chess Analyzer
Internal, browser-only chess game analyzer (Game Review style). Vite + React 19 + TS, chess.js, react-chessboard v5 (`<Chessboard options={{...}} />` API), Stockfish 19 lite WASM in a Worker (`public/engine/stockfish.js`, copied on postinstall), Dexie (IndexedDB), Recharts.

- Shared types: `src/types/index.ts`. DB: `src/db/db.ts`. Do not redefine these elsewhere.
- Styling: plain CSS with tokens in `src/index.css` (dark theme, `.card`, `.btn`, `.btn-primary`, `.tabs`, `.badge`, `.input`...). Reuse classes/tokens; page-specific CSS goes in `src/pages/<Page>.css`. UI must feel polished and smooth (transitions, hover states, empty states).
- UI copy in Spanish (rioplatense neutral). Code/comments in English.
- `npm test` (vitest), `npm run build`.
