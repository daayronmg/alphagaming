import { useParams, useSearchParams } from 'react-router-dom';
import PartWorkspace from '../components/PartWorkspace';

export default function PartView() {
  const { partId } = useParams();
  const [sp] = useSearchParams();
  return <PartWorkspace key={partId} partId={partId!} initialMeasure={sp.get('compas') ? Number(sp.get('compas')) : null} initialDoubt={sp.get('duda')} />;
}
