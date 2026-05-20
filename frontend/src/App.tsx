import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Landing } from "./components/Landing";
import { LegalDisclaimerModal } from "./components/LegalDisclaimerModal";

function App() {
  return (
    <BrowserRouter>
      <LegalDisclaimerModal />
      <Routes>
        <Route path="/" element={<Landing />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App
