// Contenido inicial de la Academia (teoría musical general, redactado para ESTRELLA).
// Niveles 1 y 2: teoría general, publicables. Nivel 3: técnica aplicada; los apartados
// específicos de instrumento quedan «en revisión» hasta que los validen los responsables.

type Quiz = { q: string; options: string[]; answer: number; explain?: string }[];
export interface SeedLesson {
  title: string; explanation: string; demo?: any; audio?: any; exercise?: any; quiz: Quiz; practice: string; summary: string;
  status?: 'publicado' | 'revision' | 'borrador';
}
export interface SeedCourse { level: 1 | 2 | 3; title: string; description: string; status: 'publicado' | 'revision'; section?: string; lessons: SeedLesson[] }

const LINE_NOTES = ['E4', 'G4', 'B4', 'D5', 'F5'];
const SPACE_NOTES = ['F4', 'A4', 'C5', 'E5'];

export const COURSES: SeedCourse[] = [
  {
    level: 1, status: 'publicado', title: 'Fundamentos de la lectura musical',
    description: 'Desde cero: qué es una nota, cómo se escribe y cómo se lee una partitura sencilla.',
    lessons: [
      {
        title: '¿Qué es una nota?',
        explanation: 'Una nota es un sonido con una altura concreta: más grave o más aguda. En música occidental usamos siete nombres que se repiten: Do, Re, Mi, Fa, Sol, La y Si. Después de Si vuelve a empezar Do, pero más agudo.\n\nCada nota escrita nos dice dos cosas: qué sonido tocar (su altura, por su posición en el pentagrama) y cuánto tiempo mantenerlo (su duración, por su figura).',
        demo: { type: 'staff', clef: 'treble', notes: ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'], labels: true },
        audio: { notes: ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'], tempo: 90 },
        exercise: { type: 'identify', clef: 'treble', notes: ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'], rounds: 8 },
        quiz: [
          { q: '¿Cuántos nombres de notas distintos usamos?', options: ['5', '7', '12', '8'], answer: 1, explain: 'Do, Re, Mi, Fa, Sol, La, Si.' },
          { q: '¿Qué nota viene después de Si?', options: ['La', 'Re', 'Do', 'Sol'], answer: 2, explain: 'La serie vuelve a empezar en Do, una octava más aguda.' },
          { q: 'La figura de una nota indica…', options: ['Su altura', 'Su duración', 'Su volumen', 'Su instrumento'], answer: 1 },
        ],
        practice: 'Abre tu parte de cualquier marcha de la biblioteca y busca la primera nota. Intenta decir su nombre antes de tocarla.',
        summary: 'Siete nombres (Do–Si) que se repiten. Posición = altura. Figura = duración.',
      },
      {
        title: 'El pentagrama',
        explanation: 'El pentagrama son cinco líneas horizontales paralelas y los cuatro espacios que quedan entre ellas. Se cuentan siempre de abajo arriba: 1ª línea es la de abajo y 5ª la de arriba; el 1er espacio es el que está entre la 1ª y la 2ª línea.\n\nCuanto más arriba está una nota, más agudo es su sonido. Una nota puede estar «en línea» (la línea la atraviesa por el centro) o «en espacio» (está entre dos líneas).',
        demo: { type: 'staff', clef: 'treble', notes: [...LINE_NOTES, ...SPACE_NOTES], labels: false, colorMode: true },
        exercise: { type: 'line-space', clef: 'treble', notes: ['E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'D5', 'E5', 'F5'], rounds: 10 },
        quiz: [
          { q: '¿Cuántas líneas tiene un pentagrama?', options: ['4', '5', '6', '7'], answer: 1 },
          { q: '¿Cuántos espacios hay entre las líneas?', options: ['3', '4', '5', '6'], answer: 1 },
          { q: 'Las líneas se cuentan…', options: ['De arriba abajo', 'De abajo arriba', 'Desde la clave', 'Da igual'], answer: 1 },
        ],
        practice: 'En tu partitura, elige cinco notas y di si están en línea o en espacio. Si tu partitura tiene colores activados, comprueba: rojo = sobre línea, azul = fuera de las líneas.',
        summary: '5 líneas, 4 espacios, se cuentan de abajo arriba. Más arriba = más agudo.',
      },
      {
        title: 'Las claves',
        explanation: 'La clave, al principio del pentagrama, fija el nombre de una línea y, a partir de ella, el de todas las demás.\n\n• Clave de Sol (en 2ª línea): la nota de la 2ª línea es Sol. Es la clave de cornetas y trompetas.\n• Clave de Fa (en 4ª línea): la 4ª línea es Fa. La usan trombones, bombardinos y tubas.\n• Clave de percusión: no indica alturas; cada línea o espacio corresponde a un instrumento o sonido de percusión.\n\nUna misma posición tiene nombres distintos según la clave.',
        demo: { type: 'staff', clef: 'treble', notes: ['G4'], labels: true },
        exercise: { type: 'identify', clef: 'treble', notes: ['G4', 'E4', 'B4', 'D5', 'F5'], rounds: 8 },
        quiz: [
          { q: 'En clave de Sol, la 2ª línea es…', options: ['Mi', 'Sol', 'Si', 'Fa'], answer: 1 },
          { q: '¿Qué clave usan normalmente las cornetas?', options: ['Fa', 'Do', 'Sol', 'Percusión'], answer: 2 },
          { q: 'La clave de percusión indica…', options: ['Alturas exactas', 'Qué instrumento o golpe', 'El tempo', 'La dinámica'], answer: 1 },
        ],
        practice: 'Mira la clave al principio de tu parte. ¿Cuál es? Busca la línea que fija esa clave.',
        summary: 'Sol en 2ª línea (cornetas, trompetas). Fa en 4ª (metales graves). Percusión: instrumentos, no alturas.',
      },
      {
        title: 'Líneas y espacios en clave de Sol',
        explanation: 'Notas en las líneas (de abajo arriba): Mi – Sol – Si – Re – Fa.\nNotas en los espacios: Fa – La – Do – Mi.\n\nTruco: los espacios forman la palabra «FA-LA-DO-MI». Las líneas van saltando de una en una: Mi, (Fa), Sol, (La), Si, (Do), Re, (Mi), Fa.',
        demo: { type: 'staff', clef: 'treble', notes: [...LINE_NOTES, ...SPACE_NOTES], labels: true, colorMode: true },
        audio: { notes: LINE_NOTES, tempo: 80 },
        exercise: { type: 'identify', clef: 'treble', notes: [...LINE_NOTES, ...SPACE_NOTES], rounds: 12 },
        quiz: [
          { q: '¿Qué nota está en la 3ª línea (clave de Sol)?', options: ['Sol', 'Si', 'Re', 'La'], answer: 1 },
          { q: '¿Qué nota está en el 3er espacio?', options: ['Do', 'La', 'Mi', 'Si'], answer: 0 },
          { q: 'La 5ª línea es…', options: ['Mi', 'Fa', 'Sol', 'Re'], answer: 1 },
        ],
        practice: 'Haz una ronda del Entrenamiento de lectura con «solo pentagrama» hasta acertar 10 seguidas.',
        summary: 'Líneas: Mi-Sol-Si-Re-Fa. Espacios: Fa-La-Do-Mi.',
      },
      {
        title: 'Líneas adicionales',
        explanation: 'Cuando una nota es demasiado grave o aguda para el pentagrama, se añaden pequeñas líneas cortas por debajo o por encima: las líneas adicionales.\n\nEn clave de Sol, bajo el pentagrama: Re (debajo de la 1ª línea), Do (en la 1ª línea adicional), Si (debajo de ella), La (2ª línea adicional). Por encima: Sol (encima de la 5ª línea), La (1ª línea adicional superior), Si, Do (2ª adicional)…\n\nSe leen igual que el pentagrama: línea, espacio, línea…',
        demo: { type: 'staff', clef: 'treble', notes: ['A3', 'B3', 'C4', 'D4', 'G5', 'A5', 'B5', 'C6'], labels: true, colorMode: true },
        exercise: { type: 'identify', clef: 'treble', notes: ['A3', 'B3', 'C4', 'D4', 'G5', 'A5', 'B5', 'C6'], rounds: 10 },
        quiz: [
          { q: 'En clave de Sol, la 1ª línea adicional inferior es…', options: ['Re', 'Do', 'Si', 'La'], answer: 1 },
          { q: 'La 1ª línea adicional superior es…', options: ['Sol', 'La', 'Si', 'Do'], answer: 1 },
          { q: 'Una nota sobre una línea adicional, en el código de colores de ESTRELLA, se muestra…', options: ['En rojo', 'En azul', 'En negro', 'Depende de la duración'], answer: 1, explain: 'El rojo se reserva para notas sobre las cinco líneas del pentagrama.' },
        ],
        practice: 'Busca en tu parte una nota con línea adicional y nómbrala contando desde la nota más cercana que ya conoces.',
        summary: 'Fuera del pentagrama se siguen leyendo líneas y espacios. Do central = 1ª adicional inferior.',
      },
      {
        title: 'Alteraciones: sostenido, bemol y becuadro',
        explanation: 'Las alteraciones cambian la altura de una nota medio tono:\n• Sostenido (♯): sube medio tono.\n• Bemol (♭): baja medio tono.\n• Becuadro (♮): anula una alteración anterior y la nota vuelve a ser natural.\n\nSi aparecen al principio de cada pentagrama (armadura) afectan a todas esas notas de la obra. Si aparecen junto a una nota (accidentales) afectan a esa nota y a las iguales del resto de ese compás.',
        demo: { type: 'staff', clef: 'treble', notes: ['F4', 'F#4', 'B4', 'Bb4', 'B4'], labels: true },
        audio: { notes: ['F4', 'F#4', 'B4', 'Bb4'], tempo: 70 },
        quiz: [
          { q: 'El sostenido…', options: ['Baja medio tono', 'Sube medio tono', 'Anula alteraciones', 'Alarga la nota'], answer: 1 },
          { q: 'Un accidental dura…', options: ['Toda la obra', 'Hasta el final del compás', 'Solo esa nota', 'Hasta el siguiente pentagrama'], answer: 1 },
          { q: 'El becuadro…', options: ['Sube un tono', 'Anula la alteración', 'Indica silencio', 'Indica repetición'], answer: 1 },
        ],
        practice: 'Mira la armadura de tu parte: ¿hay sostenidos o bemoles? ¿A qué notas afectan?',
        summary: '♯ sube, ♭ baja, ♮ anula. Armadura = toda la obra; accidental = hasta la barra de compás.',
      },
      {
        title: 'Figuras y silencios',
        explanation: 'La figura indica la duración. Tomando la negra como 1 tiempo:\n• Redonda = 4 tiempos\n• Blanca = 2\n• Negra = 1\n• Corchea = ½\n• Semicorchea = ¼\n\nCada figura tiene su silencio equivalente, que dura lo mismo pero sin sonar. El puntillo, a la derecha de una figura, le suma la mitad de su valor: negra con puntillo = 1½ tiempos.',
        demo: { type: 'rhythm', figures: ['w', 'h', 'q', '8', '16'] },
        audio: { rhythm: [['q', false], ['q', false], ['8', false], ['8', false], ['q', false], ['h', false]], tempo: 80 },
        exercise: { type: 'rhythm-tap', pattern: ['q', 'q', '8', '8', 'q'], tempo: 70 },
        quiz: [
          { q: '¿Cuántas corcheas caben en una blanca?', options: ['2', '4', '8', '1'], answer: 1 },
          { q: 'Negra con puntillo dura…', options: ['1 tiempo', '1½ tiempos', '2 tiempos', '¾ de tiempo'], answer: 1 },
          { q: 'Un silencio de blanca dura…', options: ['1 tiempo', '2 tiempos', '4 tiempos', 'Nada'], answer: 1 },
        ],
        practice: 'Elige un compás de tu parte y palmea su ritmo contando los tiempos en voz alta.',
        summary: 'Redonda 4, blanca 2, negra 1, corchea ½, semicorchea ¼. Puntillo = + mitad.',
      },
      {
        title: 'Compás y ritmo',
        explanation: 'Las barras verticales dividen la música en compases. La fracción del principio (indicación de compás) dice cuántos tiempos hay en cada compás (número de arriba) y qué figura vale un tiempo (número de abajo: 4 = negra, 8 = corchea).\n\n• 2/4: dos negras por compás, muy habitual en marchas.\n• 3/4: tres negras.\n• 4/4: cuatro negras.\n• 6/8: seis corcheas, que se sienten en dos grupos de tres.\n\nEl primer tiempo de cada compás es el más fuerte.',
        demo: { type: 'meter', meters: ['2/4', '3/4', '4/4', '6/8'] },
        exercise: { type: 'rhythm-tap', pattern: ['q', 'q', 'q', 'q'], tempo: 80, meter: [2, 4] },
        quiz: [
          { q: 'En 2/4 cada compás tiene…', options: ['2 negras', '4 negras', '2 corcheas', '4 corcheas'], answer: 0 },
          { q: 'El número de abajo indica…', options: ['El número de compases', 'La figura que vale un tiempo', 'El tempo', 'La dinámica'], answer: 1 },
          { q: '¿Qué tiempo es el más fuerte?', options: ['El último', 'El primero', 'Todos igual', 'El segundo'], answer: 1 },
        ],
        practice: '¿Qué compás tiene tu marcha? Marca el primer tiempo con el pie mientras escuchas una grabación.',
        summary: 'Arriba: cuántos tiempos. Abajo: qué figura es el tiempo. El 1º es el fuerte.',
      },
      {
        title: 'El tempo',
        explanation: 'El tempo es la velocidad del pulso. Se indica en pulsos por minuto (ppm o BPM): ♩ = 80 significa 80 negras por minuto.\n\nEn una banda todos deben compartir el mismo pulso. El metrónomo ayuda a interiorizarlo: estudia primero lento, con metrónomo, y sube poco a poco cuando el pasaje salga limpio. Términos frecuentes: accelerando (acelerando), ritardando (retardando), a tempo (volver al tempo).',
        audio: { metronome: true, tempo: 80 },
        exercise: { type: 'tempo-tap', tempo: 80, beats: 8 },
        quiz: [
          { q: '♩ = 60 significa…', options: ['60 compases por minuto', '60 negras por minuto', '60 segundos por nota', '60 notas en total'], answer: 1 },
          { q: '«Ritardando» significa…', options: ['Acelerar', 'Retardar', 'Más fuerte', 'Repetir'], answer: 1 },
          { q: 'La mejor forma de estudiar un pasaje difícil es…', options: ['A tempo desde el principio', 'Lento con metrónomo y subir poco a poco', 'Sin metrónomo', 'Solo escuchar'], answer: 1 },
        ],
        practice: 'Pon el metrónomo de ESTRELLA a 60 y toca un pasaje de tu parte. Sube de 4 en 4 hasta el tempo indicado.',
        summary: 'Tempo = velocidad del pulso (BPM). Estudia lento y sube progresivamente.',
      },
      {
        title: 'Lectura básica de una partitura',
        explanation: 'Antes de tocar, haz siempre una «lectura de reconocimiento» de 30 segundos:\n1. Clave y armadura (¿qué alteraciones hay?).\n2. Indicación de compás y tempo.\n3. Busca repeticiones, saltos (D.C., D.S., Coda) y letras de ensayo.\n4. Localiza los pasajes rápidos, las notas agudas o graves y las dinámicas.\n5. Lee el ritmo antes que las notas: palmea mentalmente.\n\nAsí no te sorprende nada al empezar.',
        demo: { type: 'checklist' },
        quiz: [
          { q: '¿Qué conviene mirar primero?', options: ['La última nota', 'Clave, armadura y compás', 'El título', 'Nada'], answer: 1 },
          { q: 'Las letras de ensayo sirven para…', options: ['Decorar', 'Localizar secciones rápidamente', 'Indicar la dinámica', 'Indicar la respiración'], answer: 1 },
          { q: 'Es buena idea leer el ritmo…', options: ['Después de tocar', 'Antes que las notas', 'Nunca', 'Solo en percusión'], answer: 1 },
        ],
        practice: 'Haz la lectura de reconocimiento de tu parte de la próxima marcha del calendario y anota en ESTRELLA (anotación personal) los pasajes que te parezcan difíciles.',
        summary: 'Clave → armadura → compás/tempo → estructura → pasajes difíciles → ritmo.',
      },
    ],
  },
  {
    level: 2, status: 'publicado', title: 'Lectura aplicada',
    description: 'Velocidad de lectura, intervalos, patrones y lectura a primera vista.',
    lessons: [
      {
        title: 'Reconocer notas rápidamente (notas ancla)',
        explanation: 'Contar líneas desde abajo es lento. Memoriza unas pocas notas «ancla» y lee las demás por cercanía:\n• Sol (2ª línea): donde se enrosca la clave de Sol.\n• Do central (1ª línea adicional inferior).\n• Do agudo (3er espacio).\n• Sol agudo (encima del pentagrama).\n\nDesde un ancla: el espacio o la línea contigua es la nota siguiente; la línea siguiente está a una tercera (salta una nota).',
        demo: { type: 'staff', clef: 'treble', notes: ['C4', 'G4', 'C5', 'G5'], labels: true },
        exercise: { type: 'identify', clef: 'treble', notes: ['C4', 'G4', 'C5', 'G5', 'A4', 'B4', 'D5', 'F4'], rounds: 15, timed: true },
        quiz: [
          { q: 'Si la nota está justo encima del Sol de 2ª línea (en el espacio), es…', options: ['Fa', 'La', 'Si', 'Mi'], answer: 1 },
          { q: 'El Do agudo en clave de Sol está en…', options: ['3ª línea', '3er espacio', '4º espacio', '5ª línea'], answer: 1 },
        ],
        practice: 'Haz el Entrenamiento de lectura en modo cronometrado. ESTRELLA registra tu tiempo medio por nota.',
        summary: 'Cuatro anclas (Do central, Sol, Do agudo, Sol agudo) + leer por cercanía.',
      },
      {
        title: 'Notas en líneas adicionales sin contar',
        explanation: 'Las notas agudas de corneta y trompeta suelen ir en líneas adicionales superiores. Ancla útil: La (1ª línea adicional superior) y Do (2ª línea adicional superior). Por abajo: Do central (1ª inferior) y La (2ª inferior).\n\nFíjate en cuántas líneas adicionales hay y si la nota las atraviesa o queda por encima o por debajo.',
        demo: { type: 'staff', clef: 'treble', notes: ['A5', 'C6', 'C4', 'A3'], labels: true, colorMode: true },
        exercise: { type: 'identify', clef: 'treble', notes: ['G5', 'A5', 'B5', 'C6', 'D4', 'C4', 'B3', 'A3'], rounds: 12, timed: true },
        quiz: [{ q: 'La 2ª línea adicional superior (clave de Sol) es…', options: ['La', 'Si', 'Do', 'Re'], answer: 2 }],
        practice: 'Marca en tu parte (anotación personal) las notas con líneas adicionales y repásalas antes del ensayo.',
        summary: 'Anclas fuera del pentagrama: La y Do arriba; Do y La abajo.',
      },
      {
        title: 'Intervalos',
        explanation: 'Un intervalo es la distancia entre dos notas. Se cuenta incluyendo ambas: de Do a Mi hay una 3ª (Do-Re-Mi).\n• 2ª: de línea a espacio contiguo (o al revés).\n• 3ª: de línea a línea o de espacio a espacio contiguos.\n• 5ª: de línea a la segunda línea siguiente.\n• 8ª (octava): misma nota, más aguda.\n\nReconocer el «dibujo» del intervalo en el papel acelera muchísimo la lectura.',
        demo: { type: 'staff', clef: 'treble', notes: ['C5', 'D5', 'C5', 'E5', 'C5', 'G5', 'C5', 'C6'], labels: true },
        audio: { notes: ['C5', 'E5', 'C5', 'G5', 'C5', 'C6'], tempo: 70 },
        exercise: { type: 'interval', clef: 'treble', intervals: [2, 3, 4, 5, 8], rounds: 10 },
        quiz: [
          { q: 'De Sol a Si hay una…', options: ['2ª', '3ª', '4ª', '5ª'], answer: 1 },
          { q: 'Dos notas en líneas contiguas forman una…', options: ['2ª', '3ª', '4ª', '8ª'], answer: 1 },
        ],
        practice: 'En tu parte, busca un salto grande y nómbralo como intervalo antes de tocarlo.',
        summary: 'Cuenta ambas notas. Línea→línea contigua = 3ª. Misma nota más aguda = 8ª.',
      },
      {
        title: 'Reconocer patrones',
        explanation: 'La música repite dibujos: escalas (notas seguidas), arpegios (saltos de 3ª), notas repetidas y ritmos que vuelven. En marchas de cornetas son muy frecuentes los arpegios y las fórmulas rítmicas repetidas.\n\nLee por grupos: en vez de «Sol, Si, Re», piensa «arpegio desde Sol».',
        demo: { type: 'staff', clef: 'treble', notes: ['C5', 'E5', 'G5', 'E5', 'C5', 'D5', 'E5', 'F5'], labels: false },
        audio: { notes: ['C5', 'E5', 'G5', 'E5', 'C5'], tempo: 90 },
        quiz: [{ q: 'Un arpegio es…', options: ['Notas seguidas por grados', 'Notas a distancia de tercera', 'Una nota repetida', 'Un silencio'], answer: 1 }],
        practice: 'Marca con un rectángulo (anotación personal) un patrón que se repita en tu parte.',
        summary: 'Escalas, arpegios y fórmulas rítmicas: léelos como bloques.',
      },
      {
        title: 'Leer ritmos',
        explanation: 'Subdivide: cuenta «1 y 2 y» en 2/4. Las corcheas caen en los números y en las «y»; las semicorcheas se cuentan «1 e y a».\n\nPuntillo frecuente en marchas: corchea con puntillo + semicorchea = un tiempo, con la semicorchea pegada al tiempo siguiente.',
        demo: { type: 'rhythm', figures: ['8.', '16', 'q', '8', '8'] },
        audio: { rhythm: [['8', true], ['16', false], ['q', false], ['8', false], ['8', false]], tempo: 70 },
        exercise: { type: 'rhythm-tap', pattern: ['8.', '16', 'q', '8', '8', 'q'], tempo: 60 },
        quiz: [{ q: 'Corchea con puntillo + semicorchea suman…', options: ['½ tiempo', '1 tiempo', '1½ tiempos', '2 tiempos'], answer: 1 }],
        practice: 'Busca en tu parte un ritmo con puntillo y palméalo contando «1 e y a».',
        summary: 'Subdivide siempre. Puntillo + semicorchea = 1 tiempo.',
      },
      {
        title: 'Lectura a primera vista',
        explanation: 'Leer a primera vista es tocar algo sin haberlo estudiado. Reglas:\n1. 30 segundos de reconocimiento (clave, armadura, compás, estructura).\n2. Elige un tempo que puedas mantener.\n3. No pares: si fallas, sigue con el pulso.\n4. Mira siempre un poco por delante de lo que tocas.',
        exercise: { type: 'identify', clef: 'treble', notes: ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'D5', 'E5', 'F5', 'G5'], rounds: 20, timed: true },
        quiz: [{ q: 'Si te equivocas leyendo a primera vista…', options: ['Paras y repites', 'Sigues con el pulso', 'Empiezas de nuevo', 'Subes el tempo'], answer: 1 }],
        practice: 'Abre una marcha que no conozcas de la biblioteca y léela sin parar a un tempo lento.',
        summary: 'Reconocer, tempo prudente, no parar, mirar por delante.',
      },
      {
        title: 'Lectura adaptada a tu instrumento',
        explanation: 'Cada instrumento lee en su clave y, a veces, en su propia afinación (instrumentos transpositores). La corneta y la trompeta en Si♭ leen una nota escrita que suena un tono más grave. Por eso las partes de cada voz pueden verse distintas aunque suenen juntas.\n\nESTRELLA te abre siempre la parte de tu instrumento y voz; si no existe, te avisa en lugar de mostrarte otra.',
        quiz: [{ q: 'Una corneta en Si♭ que lee un Do escrito suena…', options: ['Do', 'Si♭', 'Re', 'La'], answer: 1 }],
        practice: 'Comprueba en tu ficha qué instrumento y voz tienes asignados y abre tu parte de una marcha.',
        summary: 'Cada voz tiene su parte. Instrumentos en Si♭: suena un tono más bajo que lo escrito.',
      },
    ],
  },
  {
    level: 3, status: 'publicado', title: 'Técnica aplicada a la banda',
    description: 'Hábitos y técnica de conjunto. Los apartados específicos por instrumento los revisan los responsables antes de publicarse.',
    lessons: [
      {
        title: 'Control del tempo en conjunto',
        explanation: 'En una banda nadie lleva el tempo «a su manera»: se sigue al director y a la percusión. Los errores típicos son acelerar en los pasajes fuertes o fáciles y retrasar en los difíciles. Estudia con metrónomo y, en ensayo, escucha el bombo y la caja.',
        audio: { metronome: true, tempo: 76 },
        exercise: { type: 'tempo-tap', tempo: 76, beats: 16 },
        quiz: [{ q: 'Lo más habitual al tocar fuerte es…', options: ['Retrasar', 'Acelerar', 'Desafinar', 'Nada'], answer: 1 }],
        practice: 'En tu próximo estudio, toca la marcha con el metrónomo de ESTRELLA y fíjate en qué pasajes tiendes a acelerar.',
        summary: 'Sigue al director y a la percusión. Vigila acelerar en lo fuerte o fácil.',
      },
      {
        title: 'Entradas y finales',
        explanation: 'Una entrada limpia empieza antes de sonar: cuenta los compases de silencio, prepara la respiración o el golpe en el tiempo anterior y entra junto al resto. En los finales, mantén la nota todo su valor y corta a la vez que la dirección.',
        quiz: [{ q: 'Una entrada se prepara…', options: ['En el mismo tiempo', 'En el tiempo anterior', 'Después de oír a los demás', 'No se prepara'], answer: 1 }],
        practice: 'Señala con una anotación personal las entradas tras silencios largos de tu parte.',
        summary: 'Contar, preparar en el tiempo anterior, entrar y cortar juntos.',
      },
      {
        title: 'Coordinación entre secciones',
        explanation: 'Escucha a las otras voces: saber qué toca la sección vecina en cada momento ayuda a encajar. Usa las grabaciones de referencia y el modo «voz aislada» del reproductor para oír tu voz y después el conjunto.',
        quiz: [{ q: 'Para encajar mejor conviene…', options: ['Tocar más fuerte', 'Conocer lo que tocan las otras voces', 'Mirar solo tu parte', 'Acelerar'], answer: 1 }],
        practice: 'Escucha la grabación de la marcha siguiendo tu parte en la pantalla.',
        summary: 'Escuchar al resto es parte de tocar tu voz.',
      },
      {
        title: 'Hábitos de estudio',
        explanation: 'Mejor 15 minutos diarios que 2 horas un día. Estructura: calentamiento, lectura, trabajo de pasajes difíciles en bucle lento y una pasada completa. Apunta qué has trabajado. El asistente de ESTRELLA puede proponerte una rutina con tus fallos más frecuentes.',
        quiz: [{ q: '¿Qué es más eficaz?', options: ['Estudiar mucho un día', 'Estudiar poco cada día', 'Solo en ensayos', 'Solo escuchar'], answer: 1 }],
        practice: 'Pide al asistente: «Hazme una rutina de 15 minutos».',
        summary: 'Constancia diaria con estructura.',
      },
      {
        title: 'Interpretación musical',
        explanation: 'Interpretar es respetar lo escrito (notas, ritmo, dinámicas, articulación) y las indicaciones de la dirección para que la banda suene como una sola. Las anotaciones oficiales del director en ESTRELLA forman parte de la interpretación de cada marcha.',
        quiz: [{ q: 'Las indicaciones del director…', options: ['Son opcionales', 'Forman parte de la interpretación', 'Solo para los responsables', 'Solo en conciertos'], answer: 1 }],
        practice: 'Revisa la capa de anotaciones oficiales de una marcha y repasa cada indicación.',
        summary: 'Lo escrito + las indicaciones de la dirección = interpretación común.',
      },
      {
        title: 'Corneta: respiración y emisión',
        status: 'revision',
        explanation: '[Pendiente de revisión por el responsable de cornetas]\nRespiración: inspira profundo y sin tensión en hombros, llenando la parte baja de los pulmones. Emisión: el sonido nace de la vibración de los labios con el aire constante; la lengua solo inicia la nota (articulación «ta» o «da»).\nEste contenido debe adaptarse a la escuela y digitaciones que use la banda.',
        quiz: [],
        practice: 'Notas largas a volumen medio, 4 tiempos cada una, cuidando la estabilidad.',
        summary: 'Aire profundo y constante; la lengua solo articula.',
      },
      {
        title: 'Corneta: articulación y afinación',
        status: 'revision',
        explanation: '[Pendiente de revisión por el responsable de cornetas]\nArticulación: picado, ligado, acentuado. Afinación: escucha la voz principal y ajusta; las notas agudas tienden a subir si se fuerza la presión. La dirección debe validar las indicaciones concretas para el instrumento de la banda.',
        quiz: [],
        practice: 'Alterna 4 notas picadas y 4 ligadas sobre la misma nota.',
        summary: 'Articula con la lengua, afina escuchando.',
      },
      {
        title: 'Percusión: golpe, rebote y control',
        status: 'revision',
        explanation: '[Pendiente de revisión por el responsable de percusión]\nGolpe relajado aprovechando el rebote de la baqueta; altura de baqueta según la dinámica; el tempo de la banda depende de la regularidad de la percusión. Trabaja con metrónomo y figuras repetidas.',
        quiz: [],
        practice: 'Golpes alternos de corchea a 80 BPM durante 2 minutos, sin acelerar.',
        summary: 'Rebote, altura según dinámica, regularidad absoluta.',
      },
    ],
  },
];
