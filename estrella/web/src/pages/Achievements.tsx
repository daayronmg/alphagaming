import { useEffect } from 'react';
import { Trophy } from '../components/icons';
import { Spinner, ErrorBox } from '../components/ui';
import { AchievementGrid, useAchievements, markAchievementsSeen } from '../components/Achievements';

/** Mis logros: medallas por constancia y participación (asistencia, estudio, repertorio…). */
export default function AchievementsPage() {
  const d = useAchievements();
  useEffect(() => { if (d.data) markAchievementsSeen(d.data); }, [d.data]);
  if (d.error) return <div className="page"><ErrorBox error={d.error} retry={d.reload} /></div>;
  if (!d.data) return <Spinner />;
  const { medals, total, items } = d.data;
  const gold = items.filter((i) => i.tier === 'Oro').length;
  return (
    <div className="page stack lg">
      <div className="page-head"><div><div className="eyebrow">Personal</div><h1>Mis logros</h1></div></div>
      <div className="card ach-summary">
        <div className="ach-trophy"><Trophy size={34} /></div>
        <div className="grow">
          <div className="ach-count"><strong>{medals}</strong> <span className="muted">de {total} medallas</span></div>
          <div className="bar" style={{ marginTop: 8 }}><i style={{ width: `${Math.round((medals / total) * 100)}%` }} /></div>
          <div className="xs faint" style={{ marginTop: 6 }}>{gold ? `${gold} de oro · ` : ''}Se ganan yendo a los ensayos, estudiando y participando. Se actualizan solos.</div>
        </div>
      </div>
      <AchievementGrid set={d.data} />
    </div>
  );
}
