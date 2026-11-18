import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import App from './components/App';
import { createStore, Store } from './store';

declare global {
  interface Window {
    claude?: { use(name: string): Promise<any> };
  }
}

function Boot() {
  const [store, setStore] = useState<Store | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let done = false;
    const t = setTimeout(() => !done && setProblem('Still connecting… If this doesn’t load, open the planner from its Claude link while signed in.'), 12000);
    (async () => {
      const c = window.claude;
      if (!c) {
        setProblem('Open this planner from its Claude link to use it.');
        return;
      }
      const [db, user] = await Promise.all([c.use('db'), c.use('user')]);
      done = true;
      clearTimeout(t);
      if (!db || !user) {
        setProblem('Sign in to Claude to see and update the team’s emails. If you are signed in, ask Kori to share the planner with you.');
        return;
      }
      setStore(createStore(db, user));
    })();
    return () => clearTimeout(t);
  }, []);

  if (store) return <App store={store} />;
  return (
    <div className="boot">
      <div className="boot-card">
        <span className="brand-mark">ResQ</span> <span className="brand-sub dark">Email Planner</span>
        <p className="muted-text">{problem ?? 'Loading the team’s emails…'}</p>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Boot />);
