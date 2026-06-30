import { Providers } from "./app/providers";
import { AppRoutes } from "./app/routes";

/** Aurora background orbs — global ambient layer */
function AuroraBackground() {
  return (
    <div className="aurora-bg" aria-hidden="true">
      <div className="aurora-orb aurora-orb-1" />
      <div className="aurora-orb aurora-orb-2" />
      <div className="aurora-orb aurora-orb-3" />
      <div className="aurora-orb aurora-orb-4" />
    </div>
  );
}

function App() {
  return (
    <Providers>
      <AuroraBackground />
      <AppRoutes />
    </Providers>
  );
}

export default App;
