import { Link } from 'react-router-dom';
import { useEffect } from 'react';
import { CalendarCheck, Flame, AlarmClock, Church, Sparkles, CheckCheck, Music, BookOpen, Ear, GraduationCap, MessageCircleQuestion, Megaphone, Medal, ScanFace, PenLine, Trophy, Lock, ChevronRight } from './icons';
import { get } from '../lib/api';
import { useLoad, useToast } from './ui';

export interface Achievement {
  id: string; title: string; icon: string; unit: string; value: number; levels: number[]; level: number;
  tier: 'Bronce' | 'Plata' | 'Oro' | null; max: boolean; next: number | null; goal: string; tierNext: string | null;
}
export interface AchievementSet { user: { id: string; name: string }; items: Achievement[]; medals: number; total: number }

const ICONS: Record<string, any> = { CalendarCheck, Flame, AlarmClock, Church, Sparkles, CheckCheck, Music, BookOpen, Ear, GraduationCap, MessageCircleQuestion, Megaphone, Medal, ScanFace, PenLine };
const TIER_CLASS: Record<string, string> = { Bronce: 'bronze', Plata: 'silver', Oro: 'gold' };

function Badge({ a }: { a: Achievement }) {
  const Icon = ICONS[a.icon] ?? Trophy;
  const from = a.level ? a.levels[a.level - 1] : 0;
  const pct = a.max ? 100 : Math.min(100, Math.round(((a.value - from) / ((a.next ?? 1) - from)) * 100));
  const left = a.next != null ? a.next - a.value : 0;
  return (
    <div className={`ach ${a.tier ? TIER_CLASS[a.tier] : 'locked'}`} data-testid={`ach-${a.id}`}>
      <div className="ach-medal" aria-hidden>
        <Icon size={26} />
        {!a.tier && <span className="ach-lock"><Lock size={11} /></span>}
      </div>
      <div className="ach-body">
        <div className="ach-head"><strong>{a.title}</strong>{a.tier && <span className="ach-tier">{a.tier}</span>}</div>
        <div className="small muted">{a.max ? `¡Completado! ${a.value} ${a.unit}.` : a.goal}</div>
        {!a.max && a.unit && (
          <>
            <div className="bar ach-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${pct}%` }} /></div>
            <div className="xs faint">{a.value} {a.unit} · {left > 0 ? `te falta${left === 1 ? '' : 'n'} ${left} para ${a.tierNext}` : ''}</div>
          </>
        )}
      </div>
    </div>
  );
}

export function AchievementGrid({ set }: { set: AchievementSet }) {
  // primero los conseguidos (de más a menos nivel), luego los que están más cerca
  const items = [...set.items].sort((a, b) => (b.level - a.level) || ((b.next ? b.value / b.next : 0) - (a.next ? a.value / a.next : 0)));
  return <div className="ach-grid">{items.map((a) => <Badge key={a.id} a={a} />)}</div>;
}

const SEEN = 'estrella.logros';
function readSeen(): Record<string, number> { try { return JSON.parse(localStorage.getItem(SEEN) || '{}'); } catch { return {}; } }
function writeSeen(set: AchievementSet) { try { localStorage.setItem(SEEN, JSON.stringify(Object.fromEntries(set.items.map((i) => [i.id, i.level])))); } catch { /* */ } }

/** Tarjeta de Inicio: medallas conseguidas y, si hay alguna nueva desde la última vez, se celebra. */
export function AchievementsCard() {
  const toast = useToast();
  const d = useLoad(() => get<AchievementSet>('/logros'), []);
  useEffect(() => {
    if (!d.data) return;
    const seen = readSeen();
    const first = !Object.keys(seen).length;
    const fresh = d.data.items.filter((i) => i.level > (seen[i.id] ?? 0));
    // la primera vez no se felicita por todo de golpe: solo se guarda
    if (!first) for (const f of fresh.slice(0, 2)) toast({ kind: 'ok', text: `🏆 ¡Nuevo logro! ${f.title} · ${f.tier}` });
    writeSeen(d.data);
  }, [d.data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d.data) return null;
  const got = d.data.items.filter((i) => i.tier);
  const near = d.data.items.filter((i) => !i.max).sort((a, b) => (b.next ? b.value / b.next : 0) - (a.next ? a.value / a.next : 0))[0];
  return (
    <Link to="/logros" className="card ach-card" data-testid="home-logros">
      <div className="ach-card-icon"><Trophy size={24} /></div>
      <div className="grow">
        <strong>Mis logros</strong>
        <div className="small muted">{d.data.medals} de {d.data.total} medallas{near ? ` · Próximo: ${near.title}` : ''}</div>
        <div className="ach-mini">{got.slice(0, 8).map((i) => { const Icon = ICONS[i.icon] ?? Trophy; return <span key={i.id} className={`ach-dot ${TIER_CLASS[i.tier!]}`} title={`${i.title} · ${i.tier}`}><Icon size={13} /></span>; })}</div>
      </div>
      <ChevronRight size={20} className="faint" />
    </Link>
  );
}

export function useAchievements(userId?: string) {
  return useLoad(() => get<AchievementSet>(userId ? `/logros/${userId}` : '/logros'), [userId]);
}
export { writeSeen as markAchievementsSeen };
