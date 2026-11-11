// Iconos a color de las hojas de opciones (tipo de evento y forma de añadir una marcha).
const S = (p: { children: React.ReactNode }) => <svg width="44" height="44" viewBox="0 0 48 48" aria-hidden="true">{p.children}</svg>;

export const IcoEnsayo = () => (
  <S>
    {[12, 18, 24, 30, 36].map((y) => <rect key={y} x="4" y={y} width={y > 26 ? 22 : 30} height="2.4" rx="1.2" fill="#B0BEC5" />)}
    <path d="M36 10 V32" stroke="#E53935" strokeWidth="3.4" strokeLinecap="round" /><path d="M36 10 Q44 12 44 20" stroke="#E53935" strokeWidth="3.4" fill="none" strokeLinecap="round" />
    <ellipse cx="31" cy="34" rx="6.5" ry="5" fill="#E53935" />
  </S>
);
export const IcoActuacion = () => (
  <S>
    <path d="M17 34 V12 L40 7 V29" stroke="#E53935" strokeWidth="4" fill="none" strokeLinejoin="round" />
    <path d="M17 17 L40 12" stroke="#E53935" strokeWidth="4" />
    <ellipse cx="11.5" cy="35" rx="7" ry="5.5" fill="#E53935" /><ellipse cx="34.5" cy="30" rx="7" ry="5.5" fill="#E53935" />
  </S>
);
export const IcoOtro = () => (
  <S>
    <rect x="5" y="9" width="38" height="34" rx="5" fill="#CFD8DC" />
    <path d="M5 14 a5 5 0 0 1 5 -5 h28 a5 5 0 0 1 5 5 v6 H5 Z" fill="#F44336" />
    <rect x="13" y="4" width="4" height="10" rx="2" fill="#90A4AE" /><rect x="31" y="4" width="4" height="10" rx="2" fill="#90A4AE" />
    {[0, 1, 2, 3].flatMap((c) => [0, 1, 2].map((r) => <rect key={`${c}-${r}`} x={11 + c * 7} y={24 + r * 6} width="4.5" height="4" rx="1" fill="#78909C" />))}
  </S>
);
export const IcoPdf = () => (
  <S>
    <path d="M9 3 H30 L40 13 V45 H9 Z" fill="#FF5722" />
    <path d="M30 3 V13 H40 Z" fill="#FFAB91" />
    <text x="24.5" y="33" textAnchor="middle" fontFamily="Arial, sans-serif" fontWeight="700" fontSize="11" fill="#fff">PDF</text>
  </S>
);
export const IcoCarpeta = () => (
  <S>
    <path d="M3 12 a3 3 0 0 1 3 -3 h12 l4 5 h20 a3 3 0 0 1 3 3 v22 a3 3 0 0 1 -3 3 H6 a3 3 0 0 1 -3 -3 Z" fill="#FFC107" />
    <path d="M3 18 H45 V39 a3 3 0 0 1 -3 3 H6 a3 3 0 0 1 -3 -3 Z" fill="#FFD54F" />
    <path d="M26 22 V33" stroke="#E91E63" strokeWidth="2.8" strokeLinecap="round" /><path d="M26 22 L32 24" stroke="#E91E63" strokeWidth="2.8" strokeLinecap="round" />
    <ellipse cx="22.5" cy="34" rx="4.2" ry="3.3" fill="#E91E63" />
  </S>
);
export const IcoAudio = () => (
  <S>
    <path d="M9 3 H30 L40 13 V45 H9 Z" fill="#90CAF9" />
    <path d="M30 3 V13 H40 Z" fill="#E3F2FD" />
    <path d="M26 20 V33" stroke="#1565C0" strokeWidth="2.8" strokeLinecap="round" /><path d="M26 20 L32 22.5" stroke="#1565C0" strokeWidth="2.8" strokeLinecap="round" />
    <ellipse cx="22.5" cy="34" rx="4.2" ry="3.3" fill="#1565C0" />
  </S>
);
export const IcoSeguir = () => (
  <S><path d="M7 24 H40 M28 12 L40 24 L28 36" stroke="currentColor" strokeWidth="3.4" fill="none" strokeLinecap="round" strokeLinejoin="round" /></S>
);
