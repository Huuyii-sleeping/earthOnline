import { Providers } from "./app/providers";
import { AppRoutes } from "./app/routes";

function App() {
  return (
    <Providers>
      <AppRoutes />
    </Providers>
  );
}

export default App;
