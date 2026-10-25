// Bots de NextGranMaestro. Todos usan Stockfish, pero cada uno está limitado para jugar como una persona de cierto nivel.
// El Elo es APROXIMADO (no es un Elo oficial de FIDE ni de ninguna plataforma).
export type BotKind = 'rand' | 'uci' | 'max';
export interface Bot {
  id: string; name: string; elo: number; premium: boolean; kind: BotKind; desc: string;
  depth?: number;   // 'rand': profundidad de búsqueda
  pool?: number;    // 'rand': jugadas candidatas
  blunder?: number; // 'rand': probabilidad de jugar una jugada al azar
  temp?: number;    // 'rand': cuanto mayor, más se aleja de la mejor jugada (centipeones)
  ms?: number;      // 'uci' y 'max': tiempo de pensar por jugada
}
export const BOTS: Bot[] = [
  { id: 'pepe',   name: 'Pepe',   elo: 400,  premium: false, kind: 'rand', depth: 1, pool: 8, blunder: 0.45, temp: 400, desc: 'Acaba de aprender a mover las piezas. Deja piezas sin defender.' },
  { id: 'lucia',  name: 'Lucía',  elo: 700,  premium: false, kind: 'rand', depth: 2, pool: 6, blunder: 0.25, temp: 250, desc: 'Ve capturas fáciles, pero se despista con las tácticas.' },
  { id: 'marcos', name: 'Marcos', elo: 1000, premium: false, kind: 'rand', depth: 3, pool: 5, blunder: 0.12, temp: 160, desc: 'Juega con sentido, pero falla a veces en jugadas de dos pasos.' },
  { id: 'clara',  name: 'Clara',  elo: 1250, premium: false, kind: 'rand', depth: 5, pool: 4, blunder: 0.05, temp: 90,  desc: 'Jugadora de club: pocas piezas regaladas, algún error posicional.' },
  { id: 'alvaro', name: 'Álvaro', elo: 1500, premium: false, kind: 'uci', ms: 300, desc: 'Sólido y práctico. Castiga los descuidos.' },
  { id: 'elena',  name: 'Elena',  elo: 1700, premium: false, kind: 'uci', ms: 400, desc: 'Buena táctica y buen final. Un reto serio para aficionados.' },
  { id: 'hugo',   name: 'Hugo',   elo: 1900, premium: true,  kind: 'uci', ms: 500, desc: 'Nivel de jugador de torneo. Casi no regala nada.' },
  { id: 'sofia',  name: 'Sofía',  elo: 2100, premium: true,  kind: 'uci', ms: 600, desc: 'Ataca con precisión y convierte las ventajas.' },
  { id: 'dani',   name: 'Dani',   elo: 2300, premium: true,  kind: 'uci', ms: 700, desc: 'Nivel de maestro. Cada error cuesta una pieza.' },
  { id: 'irene',  name: 'Irene',  elo: 2600, premium: true,  kind: 'uci', ms: 900, desc: 'Nivel de gran maestro. Muy difícil de sorprender.' },
  { id: 'maestro', name: 'El Maestro', elo: 2900, premium: true, kind: 'uci', ms: 1100, desc: 'Casi sin fallos. Solo para valientes.' },
  { id: 'max',    name: 'Stockfish Máx.', elo: 3190, premium: true, kind: 'max', ms: 1300, desc: 'El motor a plena potencia dentro del navegador. Ganarle es muy improbable.' },
];
export const botById = (id: string) => BOTS.find((b) => b.id === id);
