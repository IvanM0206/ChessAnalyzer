# Chess Analyzer

Analizador de partidas propio, estilo "Game Review". Corre 100 % en el navegador (Stockfish 19 WASM, IndexedDB).

```bash
npm install        # copia el motor a public/engine
npm run dev        # http://localhost:5173
npm test
npm run build      # salida estática en dist/
```

- Importá partidas desde Chess.com, Lichess o PGN.
- Analizá: clasificación de jugadas (brillante → error grave), precisión, gráfico de evaluación, mejor jugada.
- Umbrales, profundidad y tema del tablero en Configuración.
- `npm run build:openings` regenera `public/openings.json` (requiere los TSV de lichess-org/chess-openings en `scripts/openings-src/`).
