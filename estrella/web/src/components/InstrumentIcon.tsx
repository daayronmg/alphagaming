// Iconos de instrumentos dibujados para la app (estilo plano y a color).
const G = '#F4B400';   // latón
const GD = '#C88A04';  // latón oscuro
const GL = '#FFD95A';  // brillo

function Corneta() {
  return (
    <g>
      {/* tubo enrollado */}
      <path d="M12 22 H38 A10 10 0 0 1 38 42 H26 A6 6 0 0 1 26 30 H44" fill="none" stroke={G} strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 22 H38" stroke={GL} strokeWidth="1.4" strokeLinecap="round" />
      {/* boquilla */}
      <rect x="5" y="19.5" width="8" height="5" rx="2" fill={GD} />
      {/* campana */}
      <path d="M43 27.5 L56 18 Q60 30 56 42 L43 32.5 Z" fill={G} stroke={GD} strokeWidth="1.5" strokeLinejoin="round" />
      <ellipse cx="57" cy="30" rx="2.6" ry="12" fill={GD} />
      {/* cordón */}
      <path d="M30 42 Q31 52 24 56 M30 42 Q33 51 38 55" stroke="#D93025" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <circle cx="24" cy="56" r="2.6" fill="#D93025" /><circle cx="38" cy="55" r="2.6" fill="#D93025" />
    </g>
  );
}

function Trompeta() {
  return (
    <g>
      <path d="M10 28 H42 M18 38 H42 M18 28 A5 5 0 0 0 18 38" fill="none" stroke={G} strokeWidth="4" strokeLinecap="round" />
      <rect x="3" y="26" width="8" height="4" rx="1.6" fill={GD} />
      {[22, 29, 36].map((x) => (
        <g key={x}><rect x={x - 2.5} y="20" width="5" height="24" rx="2" fill={G} stroke={GD} strokeWidth="1.2" /><rect x={x - 3.2} y="16" width="6.4" height="4" rx="1.5" fill={GD} /></g>
      ))}
      <path d="M41 25.5 L56 16 Q61 33 56 50 L41 40.5 Z" fill={G} stroke={GD} strokeWidth="1.5" strokeLinejoin="round" />
      <ellipse cx="57.5" cy="33" rx="2.6" ry="17" fill={GD} />
    </g>
  );
}

function Trombon() {
  return (
    <g>
      {/* vara */}
      <path d="M6 24 H40 M6 38 H34 M6 24 A7 7 0 0 0 6 38" fill="none" stroke={G} strokeWidth="3.6" strokeLinecap="round" />
      <path d="M8 24 H40" stroke={GL} strokeWidth="1.2" />
      <rect x="24" y="35" width="4" height="6" rx="1" fill={GD} />
      <rect x="36" y="20" width="6" height="5" rx="1.5" fill={GD} />
      {/* tudel y campana */}
      <path d="M34 38 H46 M40 24 H46" fill="none" stroke={G} strokeWidth="3.6" strokeLinecap="round" />
      <path d="M45 21 L57 12 Q62 31 57 50 L45 41 Z" fill={G} stroke={GD} strokeWidth="1.5" strokeLinejoin="round" />
      <ellipse cx="58.5" cy="31" rx="2.6" ry="19" fill={GD} />
    </g>
  );
}

function Bombardino({ big = false }: { big?: boolean }) {
  const bw = big ? 15 : 11;
  return (
    <g>
      {/* cuerpo cónico */}
      <path d={`M${36 - bw} 10 L${36 + bw} 10 L42 44 Q42 56 32 56 Q22 56 22 46 V36`} fill="none" stroke={G} strokeWidth="4" strokeLinejoin="round" />
      <path d={`M${36 - bw} 10 L${36 + bw} 10 L41 40 L31 40 Z`} fill={G} stroke={GD} strokeWidth="1.4" strokeLinejoin="round" />
      <ellipse cx="36" cy="10" rx={bw} ry="3.6" fill={GD} />
      <ellipse cx="36" cy="10" rx={bw - 3} ry="2" fill="#7A5200" />
      {/* pistones */}
      {[14, 20, 26].map((x) => (
        <g key={x}><rect x={x - 2.4} y="26" width="4.8" height="16" rx="2" fill={G} stroke={GD} strokeWidth="1.2" /><rect x={x - 3} y="22.5" width="6" height="3.5" rx="1.4" fill={GD} /></g>
      ))}
      <path d="M11 42 H30" stroke={G} strokeWidth="3.4" strokeLinecap="round" />
      {/* boquilla */}
      <path d="M12 26 Q8 20 10 14" stroke={G} strokeWidth="3" fill="none" strokeLinecap="round" />
      <rect x="7.5" y="9" width="5" height="6" rx="1.6" fill={GD} />
    </g>
  );
}

function Caja() {
  return (
    <g>
      {/* baquetas */}
      <path d="M14 6 L32 26 M50 6 L32 26" stroke="#B5763A" strokeWidth="3.2" strokeLinecap="round" />
      <circle cx="14" cy="6" r="2.4" fill="#8A5527" /><circle cx="50" cy="6" r="2.4" fill="#8A5527" />
      {/* cuerpo */}
      <path d="M8 28 V46 Q32 56 56 46 V28" fill="#E53935" />
      <path d="M8 28 V46 Q32 56 56 46 V28" fill="none" stroke="#8FD3E8" strokeWidth="2.6" />
      {[16, 26, 38, 48].map((x) => <path key={x} d={`M${x} 31 L${x + 3} 38 L${x} 45`} stroke="#fff" strokeWidth="1.8" fill="none" strokeLinejoin="round" />)}
      <ellipse cx="32" cy="28" rx="24" ry="8" fill="#FFF3D9" stroke="#8FD3E8" strokeWidth="2.6" />
    </g>
  );
}

function Bombo() {
  return (
    <g>
      <ellipse cx="34" cy="34" rx="16" ry="24" fill="#B5763A" />
      <rect x="18" y="10" width="16" height="48" fill="#B5763A" />
      {[20, 26, 32].map((x) => <path key={x} d={`M${x} 12 V56`} stroke="#8A5527" strokeWidth="1.6" />)}
      <ellipse cx="18" cy="34" rx="14" ry="24" fill="#FFF3D9" stroke="#2F3B45" strokeWidth="3" />
      <ellipse cx="18" cy="34" rx="9" ry="16" fill="none" stroke="#E9DDC2" strokeWidth="1.4" />
      {/* maza */}
      <path d="M40 46 L56 58" stroke="#8A5527" strokeWidth="3" strokeLinecap="round" />
      <circle cx="38" cy="44" r="5" fill="#F2EAD8" stroke="#8A5527" strokeWidth="1.6" />
    </g>
  );
}

function Platos() {
  return (
    <g>
      <ellipse cx="22" cy="34" rx="16" ry="5" transform="rotate(-24 22 34)" fill={G} stroke={GD} strokeWidth="1.5" />
      <ellipse cx="22" cy="34" rx="4.5" ry="2.4" transform="rotate(-24 22 34)" fill={GD} />
      <ellipse cx="42" cy="34" rx="16" ry="5" transform="rotate(24 42 34)" fill={G} stroke={GD} strokeWidth="1.5" />
      <ellipse cx="42" cy="34" rx="4.5" ry="2.4" transform="rotate(24 42 34)" fill={GD} />
      <path d="M26 20 L29 14 M32 18 V11 M38 20 L35 14" stroke="#9AA4AE" strokeWidth="2" strokeLinecap="round" />
    </g>
  );
}

function Nota() {
  return (
    <g>
      <path d="M26 46 V14 L50 9 V40" stroke="#2F3B45" strokeWidth="4" fill="none" strokeLinejoin="round" />
      <ellipse cx="20" cy="47" rx="7.5" ry="5.5" fill="#2F3B45" /><ellipse cx="44" cy="41" rx="7.5" ry="5.5" fill="#2F3B45" />
    </g>
  );
}

const MAP: Record<string, () => JSX.Element> = {
  corneta: Corneta, trompeta: Trompeta, 'trombón': Trombon, trombon: Trombon, bombardino: () => <Bombardino />, tuba: () => <Bombardino big />,
  caja: Caja, bombo: Bombo, platos: Platos,
};

export function InstrumentIcon({ name, size = 44 }: { name: string; size?: number }) {
  const Icon = MAP[name.toLowerCase()] ?? Nota;
  return <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true"><Icon /></svg>;
}
